import type { SyncSheetRow } from "../../core/types";
import { mapStatusToWoo } from "./status-mapper";
import { parseCommaList } from "./taxonomy";

function toText(value: unknown) {
  return String(value ?? "").trim();
}

const META_PREFIX = "meta_data:";

const DIRECT_FIELDS: Record<string, string> = {
  title: "name",
  handle: "slug",
  type: "type",
  body_html: "description",
  description: "description",
  short_description: "short_description",
};

/**
 * Builds a WooCommerce product payload from a SyncSheetRow.
 * If `allowedColumns` is provided, only those columns will be included.
 */
export function buildWooProductPayload(
  row: SyncSheetRow,
  allowedColumns?: string[]
): Record<string, any> {
  const all = !allowedColumns || allowedColumns.length === 0;
  const cols = new Set(allowedColumns ?? []);
  const include = (c: string) => all || cols.has(c);

  const payload: Record<string, any> = {};
  const meta: Array<{ key: string; value: string }> = [];

  for (const [col, field] of Object.entries(DIRECT_FIELDS)) {
    if (!include(col)) continue;
    const value = row[col];
    if (value === undefined) continue;
    payload[field] = toText(value);
  }

  if (include("status")) {
    const status = mapStatusToWoo(row.status);
    if (status) payload.status = status;
  }

  // Pricing — Woo `simple` products only. For variable, prices live on variations.
  if (include("price")) {
    const price = toText(row.price);
    if (price) payload.regular_price = price;
  }
  if (include("compare_at_price")) {
    const sale = toText(row.compare_at_price);
    if (sale) payload.sale_price = sale;
  }

  // Inventory
  if (include("primary_sku")) {
    const sku = toText(row.primary_sku);
    if (sku) payload.sku = sku;
  }
  if (include("inventory_total")) {
    const qty = Number(row.inventory_total);
    if (Number.isFinite(qty)) {
      payload.manage_stock = true;
      payload.stock_quantity = qty;
    }
  }
  if (include("manage_stock")) {
    if (typeof row.manage_stock === "boolean") payload.manage_stock = row.manage_stock;
  }
  if (include("stock_status")) {
    const status = toText(row.stock_status).toLowerCase();
    if (status === "instock" || status === "outofstock" || status === "onbackorder") {
      payload.stock_status = status;
    }
  }

  if (include("weight")) {
    const weight = toText(row.weight);
    if (weight) payload.weight = weight;
  }

  // Featured image
  if (include("featured_image")) {
    const url = toText(row.featured_image);
    if (url) {
      const alt = toText(row.featured_image_alt_text);
      payload.images = [{ src: url, ...(alt ? { alt } : {}) }];
    }
  }

  // SEO via Yoast meta_data
  if (include("seo_title")) {
    meta.push({ key: "_yoast_wpseo_title", value: toText(row.seo_title) });
  }
  if (include("seo_description")) {
    meta.push({ key: "_yoast_wpseo_metadesc", value: toText(row.seo_description) });
  }

  if (meta.length > 0) payload.meta_data = meta;

  return payload;
}

export type TaxonomyResolution = {
  categoryNames: string[];
  tagNames: string[];
};

/** Extracts taxonomy names from a row for resolution before apply. */
export function extractTaxonomyNames(
  row: SyncSheetRow,
  allowedColumns?: string[]
): TaxonomyResolution {
  const all = !allowedColumns || allowedColumns.length === 0;
  const cols = new Set(allowedColumns ?? []);
  return {
    categoryNames: all || cols.has("categories") ? parseCommaList(row.categories) : [],
    tagNames: all || cols.has("tags") ? parseCommaList(row.tags) : [],
  };
}

export function buildWooVariationPayload(
  row: SyncSheetRow,
  allowedColumns?: string[]
): Record<string, any> {
  const all = !allowedColumns || allowedColumns.length === 0;
  const cols = new Set(allowedColumns ?? []);
  const include = (c: string) => all || cols.has(c);
  const payload: Record<string, any> = {};

  if (include("price")) {
    const price = toText(row.price);
    if (price) payload.regular_price = price;
  }
  if (include("compare_at_price")) {
    const sale = toText(row.compare_at_price);
    if (sale) payload.sale_price = sale;
  }
  if (include("primary_sku")) {
    const sku = toText(row.primary_sku);
    if (sku) payload.sku = sku;
  }
  if (include("inventory_total")) {
    const qty = Number(row.inventory_total);
    if (Number.isFinite(qty)) {
      payload.manage_stock = true;
      payload.stock_quantity = qty;
    }
  }
  if (include("status")) {
    const status = mapStatusToWoo(row.status);
    if (status) payload.status = status;
  }
  return payload;
}
