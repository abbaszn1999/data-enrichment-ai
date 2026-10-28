import type { ApprovalPreview } from "../../../../src/lib/store-agent/protocol";
import { shopifyGraphql, type ShopifyConnection } from "./client";

/**
 * Before/after for store changes, and the backups that make them undoable.
 *
 * A change names its records by id inside its variables
 * (`{ product: { id, title } }`, `{ id, tags }`, `{ variants: [{ id, price }] }`).
 * We read the current value of every field it sets, show before → after on
 * the approval card, and keep the "before" so the change can be replayed
 * backwards later.
 */

export type RecordType = "Product" | "Collection" | "ProductVariant" | "Other";

export type Snapshot = {
  id: string;
  /** A Shopify RecordType, or a WooCommerce record type on WooCommerce backups. */
  type: string;
  label: string;
  /** Present for variants: needed to restore them. */
  productId?: string;
  /** Current values of the restorable fields the change sets. */
  before: Record<string, unknown>;
  /** New values, as the change sets them. */
  after: Record<string, unknown>;
  /** Fields the change sets that undo cannot restore. */
  unsupported: string[];
};

export type Backup = {
  version: 1;
  /** Absent on backups made before WooCommerce support: those are Shopify. */
  platform?: "shopify" | "woocommerce";
  createdAt: string;
  operations: string[];
  records: Snapshot[];
};

/** Fields we can read back and write again, per record type. Keys use dot paths for SEO. */
export const RESTORABLE: Record<Exclude<RecordType, "Other">, readonly string[]> = {
  Product: ["title", "descriptionHtml", "handle", "status", "vendor", "productType", "tags", "templateSuffix", "seo.title", "seo.description"],
  Collection: ["title", "descriptionHtml", "handle", "sortOrder", "templateSuffix", "seo.title", "seo.description"],
  ProductVariant: ["price", "compareAtPrice", "barcode", "taxable"],
};

const BATCH = 100;
const MAX_LABEL = 120;

export function recordType(id: string): RecordType {
  const type = /^gid:\/\/shopify\/([A-Za-z0-9]+)\//.exec(id)?.[1];
  return type === "Product" || type === "Collection" || type === "ProductVariant" ? type : "Other";
}

/** Objects carrying an `id` in a change's variables: the records it touches and what it sets on them. */
export function collectTargets(value: unknown, out = new Map<string, Record<string, unknown>>(), depth = 0) {
  if (depth > 8 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, out, depth + 1);
    return out;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === "string" && obj.id.startsWith("gid://shopify/")) {
    out.set(obj.id, { ...(out.get(obj.id) ?? {}), ...obj });
  }
  for (const [k, v] of Object.entries(obj)) if (k !== "id") collectTargets(v, out, depth + 1);
  return out;
}

/** `{ title, seo: { title } }` → `{ title, "seo.title" }`. Nested objects other than SEO stay whole. */
export function flattenFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "id") continue;
    if (k === "seo" && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) out[`seo.${sk}`] = sv;
    } else out[k] = v;
  }
  return out;
}

function pick(node: Record<string, unknown>, field: string): unknown {
  if (field.startsWith("seo.")) return (node.seo as Record<string, unknown> | undefined)?.[field.slice(4)] ?? null;
  return node[field] ?? null;
}

const SNAPSHOT_QUERY = `query Snapshot($ids: [ID!]!) {
  nodes(ids: $ids) {
    id
    ... on Product { title descriptionHtml handle status vendor productType tags templateSuffix seo { title description } }
    ... on Collection { title descriptionHtml handle sortOrder templateSuffix seo { title description } }
    ... on ProductVariant { displayName price compareAtPrice barcode taxable product { id } }
    ... on Location { name }
    ... on MediaImage { alt }
    ... on GenericFile { alt }
    ... on Publication { name }
  }
}`;

/**
 * Read the current state of every record a change touches. One query per
 * 100 records; throttling is handled by the client.
 */
export async function snapshotTargets(
  conn: ShopifyConnection,
  targets: Map<string, Record<string, unknown>>,
  signal?: AbortSignal
): Promise<Snapshot[]> {
  const ids = [...targets.keys()];
  const nodes = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const res = await shopifyGraphql(conn, SNAPSHOT_QUERY, { ids: ids.slice(i, i + BATCH) }, signal);
    const list = ((res.data as { nodes?: Array<Record<string, unknown> | null> } | null)?.nodes ?? []).filter(Boolean) as Array<Record<string, unknown>>;
    for (const node of list) nodes.set(String(node.id), node);
  }
  return ids.map((id) => {
    const type = recordType(id);
    const node = nodes.get(id) ?? {};
    const after = flattenFields(targets.get(id) ?? {});
    const restorable = type === "Other" ? [] : RESTORABLE[type];
    const before: Record<string, unknown> = {};
    const unsupported: string[] = [];
    for (const field of Object.keys(after)) {
      if (restorable.includes(field)) before[field] = pick(node, field);
      else unsupported.push(field);
    }
    const label = String(node.title ?? node.displayName ?? node.name ?? node.alt ?? id.split("/").slice(-2).join(" ")).slice(0, MAX_LABEL);
    return {
      id,
      type,
      label,
      productId: type === "ProductVariant" ? ((node.product as { id?: string } | undefined)?.id ?? undefined) : undefined,
      before,
      after,
      unsupported,
    };
  });
}

function show(value: unknown, max = 160): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "string"
      ? value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : Array.isArray(value)
        ? value.map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v))).join(", ")
        : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The approval card's preview: the first records with before → after per field. */
export function previewFromSnapshots(records: Snapshot[], limit = 12): ApprovalPreview | null {
  if (!records.length) return null;
  const items = records.slice(0, limit).map((r) => ({
    id: r.id,
    label: r.label || r.id,
    changes: Object.entries(r.after).map(([field, after]) => ({
      field,
      before: field in r.before ? show(r.before[field]) : undefined,
      after: show(after),
    })),
  }));
  return { items, more: Math.max(0, records.length - limit) };
}

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Every change, one row per field, for the full preview in the panel. */
export function previewCsv(records: Snapshot[]): string {
  const rows = [["record", "id", "field", "before", "after"]];
  for (const r of records) {
    for (const [field, after] of Object.entries(r.after)) {
      rows.push([r.label, r.id, field, field in r.before ? show(r.before[field], 2000) : "(not shown)", show(after, 2000)]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/** True when undo can restore at least part of the change. */
export function isUndoable(records: Snapshot[]): boolean {
  return records.some((r) => Object.keys(r.before).length > 0);
}

export type RestoreOperation = { query: string; variables: Record<string, unknown>; ids: string[] };

function nest(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith("seo.")) out.seo = { ...((out.seo as Record<string, unknown>) ?? {}), [k.slice(4)]: v ?? "" };
    else out[k] = v;
  }
  return out;
}

/** The mutations that put the saved values back. */
export function restoreOperations(backup: Backup): RestoreOperation[] {
  const ops: RestoreOperation[] = [];
  const variantsByProduct = new Map<string, Array<Record<string, unknown>>>();
  for (const r of backup.records) {
    if (!Object.keys(r.before).length) continue;
    if (r.type === "Product") {
      ops.push({
        query: `mutation Undo($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id } userErrors { field message } } }`,
        variables: { product: { id: r.id, ...nest(r.before) } },
        ids: [r.id],
      });
    } else if (r.type === "Collection") {
      ops.push({
        query: `mutation Undo($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id } userErrors { field message } } }`,
        variables: { input: { id: r.id, ...nest(r.before) } },
        ids: [r.id],
      });
    } else if (r.type === "ProductVariant" && r.productId) {
      const list = variantsByProduct.get(r.productId) ?? [];
      list.push({ id: r.id, ...r.before });
      variantsByProduct.set(r.productId, list);
    }
  }
  for (const [productId, variants] of variantsByProduct) {
    ops.push({
      query: `mutation Undo($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }`,
      variables: { productId, variants },
      ids: variants.map((v) => String(v.id)),
    });
  }
  return ops;
}
