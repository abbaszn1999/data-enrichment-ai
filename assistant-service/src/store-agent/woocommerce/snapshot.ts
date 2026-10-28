import type { Snapshot } from "../shopify/snapshot";
import { wooRequest, type WooConnection } from "./client";
import type { WooRecordType, WooTarget } from "./guard";

/**
 * Before/after and undo for WooCommerce changes, on the same Snapshot shape
 * as Shopify so approval cards, previews and backups work unchanged. A
 * snapshot's id is its target key ("product:12", "variation:12/34").
 */

/** Fields we can read back and write again, per record type. */
export const WOO_RESTORABLE: Record<WooRecordType, readonly string[]> = {
  product: [
    "name", "slug", "status", "featured", "catalog_visibility", "description", "short_description", "sku", "global_unique_id",
    "regular_price", "sale_price", "date_on_sale_from", "date_on_sale_to", "tax_status", "tax_class",
    "manage_stock", "stock_quantity", "stock_status", "backorders", "low_stock_amount", "sold_individually",
    "weight", "dimensions", "shipping_class", "reviews_allowed", "upsell_ids", "cross_sell_ids", "purchase_note",
    "categories", "tags", "brands", "images", "attributes", "default_attributes", "menu_order", "meta_data",
    "external_url", "button_text", "virtual", "downloadable",
  ],
  variation: [
    "description", "sku", "global_unique_id", "regular_price", "sale_price", "date_on_sale_from", "date_on_sale_to", "status",
    "tax_status", "tax_class", "manage_stock", "stock_quantity", "stock_status", "backorders", "low_stock_amount",
    "weight", "dimensions", "shipping_class", "image", "attributes", "menu_order", "meta_data", "virtual", "downloadable",
  ],
  category: ["name", "slug", "parent", "description", "display", "image", "menu_order"],
  tag: ["name", "slug", "description"],
  brand: ["name", "slug", "parent", "description", "display", "image", "menu_order"],
  attribute: ["name", "slug", "type", "order_by", "has_archives"],
  attribute_term: ["name", "slug", "description", "menu_order"],
};

const PAGE = 100;
const RESTORE_CHUNK = 50;
const MAX_LABEL = 120;

const COLLECTION: Record<Exclude<WooRecordType, "variation" | "attribute_term">, string> = {
  product: "products",
  category: "products/categories",
  tag: "products/tags",
  brand: "products/brands",
  attribute: "products/attributes",
};

/** The list route for records of one type (and parent). */
export function wooCollectionPath(type: WooRecordType, parent?: number): string {
  if (type === "variation") return `products/${parent}/variations`;
  if (type === "attribute_term") return `products/attributes/${parent}/terms`;
  return COLLECTION[type];
}

/** "variation:12/34" → { type, parent: 12, id: 34 }. */
export function parseTargetKey(key: string): { type: WooRecordType; id: number; parent?: number } | null {
  const m = /^([a-z_]+):(?:(\d+)\/)?(\d+)$/.exec(key);
  if (!m || !(m[1]! in WOO_RESTORABLE)) return null;
  return { type: m[1] as WooRecordType, parent: m[2] ? Number(m[2]) : undefined, id: Number(m[3]) };
}

/** A field's current value in the form the API accepts back. Undefined when it cannot be written back. */
function restorable(field: string, current: unknown, after: unknown): unknown {
  switch (field) {
    case "categories":
    case "tags":
    case "brands":
      return Array.isArray(current) ? current.map((c) => ({ id: (c as { id: number }).id })) : [];
    case "images":
      return Array.isArray(current) ? current.map((i) => ({ id: (i as { id: number }).id, alt: (i as { alt?: string }).alt ?? "" })) : [];
    case "image":
      // A missing image cannot be put back as "no image" through the API.
      if (!current || typeof current !== "object" || !(current as { id?: number }).id) return undefined;
      return { id: (current as { id: number }).id };
    case "meta_data": {
      const existing = new Map((Array.isArray(current) ? current : []).map((m) => [String((m as { key: string }).key), (m as { value: unknown }).value]));
      const keys = (Array.isArray(after) ? after : []).map((m) => String((m as { key?: string }).key ?? "")).filter(Boolean);
      return keys.map((k) => ({ key: k, value: existing.has(k) ? existing.get(k) : "" }));
    }
    case "date_on_sale_from":
    case "date_on_sale_to":
      return current ?? "";
    default:
      return current === undefined ? null : current;
  }
}

function labelFor(type: WooRecordType, node: Record<string, unknown>, id: number): string {
  if (type === "variation") {
    const options = Array.isArray(node.attributes) ? (node.attributes as Array<{ option?: string }>).map((a) => a.option).filter(Boolean).join(" / ") : "";
    const sku = node.sku ? ` ${node.sku}` : "";
    return `Variation ${id}${sku}${options ? ` (${options})` : ""}`.slice(0, MAX_LABEL);
  }
  return String(node.name ?? `${type} ${id}`).slice(0, MAX_LABEL);
}

/** Read every record a change touches: one list request per 100 records of a type. */
export async function snapshotWooTargets(conn: WooConnection, targets: Map<string, WooTarget>, signal?: AbortSignal): Promise<Snapshot[]> {
  const groups = new Map<string, WooTarget[]>();
  for (const t of targets.values()) {
    const path = wooCollectionPath(t.type, t.parent);
    groups.set(path, [...(groups.get(path) ?? []), t]);
  }
  const nodes = new Map<string, Record<string, unknown>>();
  for (const [path, list] of groups) {
    const type = list[0]!.type;
    if (type === "attribute") {
      // Few attributes per store, and the route takes no include filter.
      const res = await wooRequest(conn, { method: "GET", path }, signal);
      for (const node of (res.ok && Array.isArray(res.data) ? res.data : []) as Array<Record<string, unknown>>) {
        nodes.set(`attribute:${node.id}`, node);
      }
      continue;
    }
    for (let i = 0; i < list.length; i += PAGE) {
      const chunk = list.slice(i, i + PAGE);
      const res = await wooRequest(conn, { method: "GET", path, query: { include: chunk.map((t) => t.id).join(","), per_page: PAGE, context: "edit" } }, signal);
      if (!res.ok || !Array.isArray(res.data)) continue;
      for (const node of res.data as Array<Record<string, unknown>>) {
        const parent = chunk[0]!.parent;
        nodes.set(`${type}:${parent ? `${parent}/` : ""}${node.id}`, node);
      }
    }
  }
  return [...targets].map(([k, t]) => {
    const node = nodes.get(k) ?? {};
    const after: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(t.fields)) if (field !== "id") after[field] = value;
    const before: Record<string, unknown> = {};
    const unsupported: string[] = [];
    for (const field of Object.keys(after)) {
      const value = WOO_RESTORABLE[t.type].includes(field) && nodes.has(k) ? restorable(field, node[field], after[field]) : undefined;
      if (value === undefined) unsupported.push(field);
      else before[field] = value;
    }
    return {
      id: k,
      type: t.type,
      label: nodes.has(k) ? labelFor(t.type, node, t.id) : k,
      productId: t.type === "variation" && t.parent ? String(t.parent) : undefined,
      before,
      after,
      unsupported,
    };
  });
}

export type WooRestoreRequest = { path: string; body: { update: Array<Record<string, unknown>> }; ids: string[] };

/** Batch updates that put the saved values back, at most 50 records each. */
export function wooRestoreRequests(records: Snapshot[]): WooRestoreRequest[] {
  const byPath = new Map<string, Array<{ key: string; item: Record<string, unknown> }>>();
  for (const r of records) {
    if (!Object.keys(r.before).length) continue;
    const target = parseTargetKey(r.id);
    if (!target) continue;
    const path = `${wooCollectionPath(target.type, target.parent)}/batch`;
    byPath.set(path, [...(byPath.get(path) ?? []), { key: r.id, item: { id: target.id, ...r.before } }]);
  }
  const requests: WooRestoreRequest[] = [];
  for (const [path, items] of byPath) {
    for (let i = 0; i < items.length; i += RESTORE_CHUNK) {
      const chunk = items.slice(i, i + RESTORE_CHUNK);
      requests.push({ path, body: { update: chunk.map((c) => c.item) }, ids: chunk.map((c) => c.key) });
    }
  }
  return requests;
}

/** Per-item errors in a batch response ({ create|update|delete: [{ id, error? }] }). */
export function wooBatchErrors(data: unknown): Array<{ id: number | null; message: string }> {
  const out: Array<{ id: number | null; message: string }> = [];
  if (!data || typeof data !== "object") return out;
  for (const list of Object.values(data as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const item of list as Array<{ id?: number; error?: { message?: string; code?: string } }>) {
      if (item?.error) out.push({ id: typeof item.id === "number" && item.id > 0 ? item.id : null, message: String(item.error.message ?? item.error.code ?? "error").replace(/<[^>]+>/g, "") });
    }
  }
  return out;
}
