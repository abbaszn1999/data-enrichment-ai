// Builds Shopify search-syntax query strings from a typed ShopifyServerFilter.
// Also applies ClientPredicates locally to SyncSheet rows for things Shopify
// cannot filter natively (missing images, empty SEO, no collections, ...).
//
// Verified against: https://shopify.dev/docs/api/usage/search-syntax

import type {
  ClientPredicate,
  ShopifyServerFilter,
  SyncSheetRow,
} from "@/lib/sync/core/types";

/** Escape a value for Shopify search syntax (quote if it contains whitespace or special chars). */
function escapeValue(value: string | number | boolean): string {
  const str = String(value);
  if (str === "") return '""';
  // Characters that must be escaped per Shopify docs: : \ ( )
  // Also quote if it contains whitespace or double quotes.
  const needsQuote = /[\s:\\()'"]/.test(str);
  if (!needsQuote) return str;
  const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function term(key: string, comparator: ":" | ":>" | ":<" | ":>=" | ":<=", value: string | number | boolean): string {
  return `${key}${comparator}${escapeValue(value)}`;
}

/** Convert a ShopifyServerFilter into a Shopify search-syntax query string. */
export function buildProductsQuery(filter: ShopifyServerFilter | null | undefined): string {
  if (!filter) return "";
  const parts: string[] = [];

  if (filter.status) parts.push(term("status", ":", filter.status.toLowerCase()));
  if (filter.vendor) parts.push(term("vendor", ":", filter.vendor));
  if (filter.productType) parts.push(term("product_type", ":", filter.productType));

  if (filter.tag) {
    const tags = Array.isArray(filter.tag) ? filter.tag : [filter.tag];
    const tagTerms = tags.filter(Boolean).map((t) => term("tag", ":", t));
    if (tagTerms.length === 1) parts.push(tagTerms[0]);
    else if (tagTerms.length > 1) parts.push(`(${tagTerms.join(" AND ")})`);
  }

  if (filter.collectionId) {
    const num = filter.collectionId.replace(/^gid:\/\/shopify\/Collection\//, "");
    parts.push(term("collection_id", ":", num));
  }

  if (filter.priceRange) {
    if (filter.priceRange.min != null) parts.push(term("price", ":>=", filter.priceRange.min));
    if (filter.priceRange.max != null) parts.push(term("price", ":<=", filter.priceRange.max));
  }
  if (filter.inventoryRange) {
    if (filter.inventoryRange.min != null) parts.push(term("inventory_total", ":>=", filter.inventoryRange.min));
    if (filter.inventoryRange.max != null) parts.push(term("inventory_total", ":<=", filter.inventoryRange.max));
  }

  if (filter.outOfStockSomewhere) parts.push(term("out_of_stock_somewhere", ":", true));
  if (filter.isPriceReduced) parts.push(term("is_price_reduced", ":", true));
  if (filter.giftCard != null) parts.push(term("gift_card", ":", filter.giftCard));

  if (filter.createdAfter) parts.push(`created_at:>${escapeValue(filter.createdAfter)}`);
  if (filter.updatedAfter) parts.push(`updated_at:>${escapeValue(filter.updatedAfter)}`);

  if (filter.handle) parts.push(term("handle", ":", filter.handle));
  if (filter.sku) parts.push(term("sku", ":", filter.sku));
  if (filter.barcode) parts.push(term("barcode", ":", filter.barcode));

  if (filter.metafield) {
    const { namespace, key, value } = filter.metafield;
    parts.push(`metafields.${namespace}.${key}:${escapeValue(value)}`);
  }

  if (filter.publishedStatus && filter.publishedStatus !== "any") {
    parts.push(term("published_status", ":", filter.publishedStatus));
  }

  if (filter.freeText) parts.push(escapeValue(filter.freeText));

  return parts.join(" AND ");
}

/** Build a `collections(query:)` string for resolve-by-name. */
export function buildCollectionsQuery(titleQuery: string): string {
  return term("title", ":", titleQuery);
}

// ─── Client-side predicate evaluation ────────────────────────────────────────

function rowVal(row: SyncSheetRow, col: string): string {
  const v = row[col];
  if (v == null) return "";
  return String(v);
}

function imageCount(row: SyncSheetRow): number {
  const c = row.image_count;
  if (typeof c === "number") return c;
  const parsed = Number(c);
  if (Number.isFinite(parsed)) return parsed;
  // Fallback: if there's a featured_image URL, count it as 1
  return rowVal(row, "featured_image") ? 1 : 0;
}

function matchesPredicate(row: SyncSheetRow, predicate: ClientPredicate): boolean {
  switch (predicate.kind) {
    case "missing_image":
      return imageCount(row) === 0;
    case "image_count_lt":
      return imageCount(row) < predicate.n;
    case "description_shorter_than":
      return rowVal(row, "body_html").length < predicate.chars;
    case "missing_seo_title":
      return rowVal(row, "seo_title").trim() === "";
    case "missing_seo_description":
      return rowVal(row, "seo_description").trim() === "";
    case "missing_alt_text":
      return rowVal(row, "featured_image_alt_text").trim() === "";
    case "title_matches": {
      try {
        return new RegExp(predicate.regex).test(rowVal(row, "title"));
      } catch {
        return false;
      }
    }
    case "no_collections": {
      const v = row.collections;
      if (Array.isArray(v)) return v.length === 0;
      return rowVal(row, "collections").trim() === "";
    }
    case "body_html_empty":
      return rowVal(row, "body_html").trim() === "";
    default:
      return false;
  }
}

/** Apply all predicates (AND semantics) and return the row indexes that match. */
export function applyClientPredicates(
  rows: SyncSheetRow[],
  predicates: ClientPredicate[] | null | undefined
): number[] {
  if (!predicates || predicates.length === 0) {
    return rows.map((_, i) => i);
  }
  const out: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (predicates.every((p) => matchesPredicate(rows[i], p))) {
      out.push(i);
    }
  }
  return out;
}
