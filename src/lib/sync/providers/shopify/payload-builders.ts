// Build Shopify GraphQL 2026-04 ProductSetInput payloads from our generic SyncSheetRow.
//
// Verified against:
//   https://shopify.dev/docs/api/admin-graphql/latest/input-objects/productsetinput
//   https://shopify.dev/docs/api/admin-graphql/latest/input-objects/productvariantsetinput
//
// Idempotency strategy: we use `identifier: { handle }` for upsert. The customId
// path has a known bug that empties existing metafields (Shopify Community 2025).

import type { SyncSheetRow } from "@/lib/sync/core/types";

// ─── Column → ProductSetInput field map ──────────────────────────────────────

/** Columns we can pass directly to ProductSetInput (non-variant, non-metafield). */
export const SHOPIFY_PRODUCT_FIELDS: Record<string, string> = {
  title: "title",
  handle: "handle",
  status: "status",
  vendor: "vendor",
  product_type: "productType",
  tags: "tags",
  body_html: "descriptionHtml",
  description: "descriptionHtml",
};

/** Columns handled specially (not direct field copies). */
export const SPECIAL_PRODUCT_COLUMNS = new Set([
  "seo_title",
  "seo_description",
  "featured_image",
  "featured_image_alt_text",
  "price",
  "compare_at_price",
  "primary_sku",
  "barcode",
  "inventory_policy",
  "inventory_total",
  "collections",
  "collections_ids",
]);

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStatus(status: string): "ACTIVE" | "ARCHIVED" | "DRAFT" | null {
  const s = status.toUpperCase();
  if (s === "ACTIVE" || s === "ARCHIVED" || s === "DRAFT") return s;
  return null;
}

function parseTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean);
  const str = toText(value);
  if (!str) return undefined;
  return str
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseCollectionIds(row: SyncSheetRow): string[] | undefined {
  // Prefer `collections_ids` if present (array of GIDs we stored on fetch).
  const ids = row.collections_ids;
  if (Array.isArray(ids)) {
    const cleaned = ids.map(toText).filter(Boolean);
    if (cleaned.length > 0) return cleaned;
  }
  return undefined;
}

export type BuildProductSetOptions = {
  /** Only include fields whose column names are in this list (if given). */
  changedColumns?: string[];
  /** Include variant sub-object (price/sku/etc). Default: true if any variant column changed. */
  includeVariant?: boolean;
  /** Include SEO. Default: auto-detect from seo_title/seo_description presence. */
  includeSeo?: boolean;
};

export type BuiltProductSetInput = {
  input: Record<string, unknown>;
  identifier: { handle: string };
};

/** Variant fields that trigger a variant sub-object in ProductSetInput. */
const VARIANT_COLUMNS = new Set([
  "price",
  "compare_at_price",
  "primary_sku",
  "barcode",
  "inventory_policy",
  "inventory_total",
]);

export function buildProductVariantSetInput(row: SyncSheetRow, changedColumns?: string[]): Record<string, unknown> | null {
  const touched = (col: string) => !changedColumns || changedColumns.includes(col);
  const variant: Record<string, unknown> = {};
  const variantId = toText(row.variant_id);
  if (variantId) variant.id = variantId;

  if (touched("price")) {
    const v = toText(row.price);
    if (v) variant.price = v;
  }
  if (touched("compare_at_price")) {
    const v = toText(row.compare_at_price);
    if (v) variant.compareAtPrice = v;
  }
  if (touched("primary_sku")) {
    const v = toText(row.primary_sku);
    if (v) variant.sku = v;
  }
  if (touched("barcode")) {
    variant.barcode = toText(row.barcode);
  }
  if (touched("inventory_policy")) {
    const p = toText(row.inventory_policy).toUpperCase();
    if (p === "CONTINUE" || p === "DENY") variant.inventoryPolicy = p;
  }

  const hasAny = Object.keys(variant).some((k) => k !== "id");
  return hasAny ? variant : null;
}

/**
 * Build a full ProductSetInput for a row.
 * - `changedColumns` narrows which fields are emitted.
 * - Always returns handle-based identifier for safe upserts.
 */
export function buildProductSetInput(
  row: SyncSheetRow,
  options: BuildProductSetOptions = {}
): BuiltProductSetInput {
  const { changedColumns } = options;
  const input: Record<string, unknown> = {};

  const touched = (col: string) => !changedColumns || changedColumns.includes(col);

  // Scalar product fields
  if (touched("title")) {
    const v = toText(row.title);
    if (v) input.title = v;
  }
  if (touched("handle")) {
    const v = toText(row.handle);
    if (v) input.handle = v;
  }
  if (touched("vendor") && row.vendor !== undefined) {
    input.vendor = toText(row.vendor);
  }
  if (touched("product_type") && row.product_type !== undefined) {
    input.productType = toText(row.product_type);
  }
  if (touched("status") && row.status !== undefined) {
    const normalized = normalizeStatus(toText(row.status));
    if (normalized) input.status = normalized;
  }
  if (touched("tags")) {
    const tags = parseTags(row.tags);
    if (tags !== undefined) input.tags = tags;
  }
  if (touched("body_html") || touched("description")) {
    const desc = toText(row.body_html ?? row.description);
    if (desc) input.descriptionHtml = desc;
  }

  // SEO
  const seoFromRow =
    (touched("seo_title") && row.seo_title !== undefined) ||
    (touched("seo_description") && row.seo_description !== undefined);
  const includeSeo = options.includeSeo ?? seoFromRow;
  if (includeSeo) {
    const seo: Record<string, unknown> = {};
    if (touched("seo_title") && row.seo_title !== undefined) seo.title = toText(row.seo_title);
    if (touched("seo_description") && row.seo_description !== undefined) {
      seo.description = toText(row.seo_description);
    }
    if (Object.keys(seo).length > 0) input.seo = seo;
  }

  // Collections (IDs only)
  if (touched("collections_ids") || touched("collections")) {
    const ids = parseCollectionIds(row);
    if (ids !== undefined) input.collections = ids;
  }

  // Variant — only if any variant column is relevant
  const variantFromCols =
    !changedColumns ||
    (Array.isArray(changedColumns) && changedColumns.some((c) => VARIANT_COLUMNS.has(c)));
  const variantTouched = options.includeVariant ?? variantFromCols;
  if (variantTouched) {
    const variant = buildProductVariantSetInput(row, changedColumns);
    if (variant) input.variants = [variant];
  }

  // Featured image for product creation / bulk productSet via FileSetInput.
  // Existing products use productCreateMedia in apply.ts so image upload
  // errors are surfaced explicitly instead of being hidden inside productSet.
  if (touched("featured_image")) {
    const url = toText(row.featured_image);
    const alt = toText(row.featured_image_alt_text);
    if (url) {
      input.files = [
        {
          originalSource: url,
          contentType: "IMAGE",
          ...(alt ? { alt } : {}),
        },
      ];
    }
  }

  const identifierHandle = toText(row.handle);
  return {
    input,
    identifier: { handle: identifierHandle },
  };
}

/** JSONL-friendly variable line for bulkOperationRunMutation running productSet. */
export function buildProductSetJsonlLine(row: SyncSheetRow, changedColumns?: string[]): string {
  const built = buildProductSetInput(row, { changedColumns });
  return JSON.stringify({ input: built.input, identifier: built.identifier });
}
