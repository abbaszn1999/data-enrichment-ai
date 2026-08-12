import type { SyncSheetRow } from "../../core/types";
import {
  buildGalleryMediaIndex,
  parseGalleryImages,
} from "../../core/gallery-images";
import { mapStatusToWoo } from "./status-mapper";
import { parseCommaList } from "./taxonomy";

function toText(value: unknown) {
  return String(value ?? "").trim();
}

type WooImageEntry = { id?: number; src?: string; alt?: string };

/**
 * WooCommerce's `images` field is the complete desired state: the first entry is
 * the featured image, the rest are the gallery, and anything omitted is deleted
 * from the product. Existing pictures must therefore be re-sent — by attachment
 * `id`, because passing `src` again makes Woo re-download the file and leaves a
 * duplicate in the media library.
 *
 * Returns null when no image column is in play, so `images` stays out of the
 * payload entirely and Woo leaves the product's media untouched.
 */
export function buildWooImagesPayload(
  row: SyncSheetRow,
  include: (column: string) => boolean
): WooImageEntry[] | null {
  const featuredTouched = include("featured_image") || include("featured_image_alt_text");
  const galleryTouched = include("gallery_images");
  if (!featuredTouched && !galleryTouched) return null;

  const mediaIndex = buildGalleryMediaIndex(row.gallery_media);
  const featuredUrl = toText(row.featured_image);
  const featuredId = Number(toText(row.featured_image_id));
  const featuredAlt = toText(row.featured_image_alt_text);
  const images: WooImageEntry[] = [];
  const usedKeys = new Set<string>();

  if (featuredUrl) {
    // A known attachment is referenced by id; a freshly searched URL is sent as
    // src so Woo imports it. Alt text rides along either way.
    const entry: WooImageEntry = Number.isInteger(featuredId) && featuredId > 0
      ? { id: featuredId }
      : { src: featuredUrl };
    if (featuredAlt) entry.alt = featuredAlt;
    images.push(entry);
    usedKeys.add(featuredUrl.toLowerCase());
  }

  for (const url of parseGalleryImages(row.gallery_images)) {
    const key = url.toLowerCase();
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    const known = mediaIndex.get(key);
    const knownId = Number(known?.id);
    images.push(
      Number.isInteger(knownId) && knownId > 0 ? { id: knownId } : { src: url }
    );
  }

  // Every image column was cleared — that is a real "remove all media" intent,
  // but an empty array is indistinguishable from a bug, so skip it instead.
  if (images.length === 0) return null;
  return images;
}

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
  if (include("global_unique_id") || include("barcode")) {
    const globalUniqueId = toText(row.global_unique_id || row.barcode);
    if (globalUniqueId) payload.global_unique_id = globalUniqueId;
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

  // Featured image + gallery share one array; see buildWooImagesPayload.
  const images = buildWooImagesPayload(row, include);
  if (images) payload.images = images;

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
  categoryIds: number[];
  categoryNames: string[];
  tagNames: string[];
};

function parseIdList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => Number(toText(v)))
      .filter((id) => Number.isInteger(id) && id > 0);
  }
  return parseCommaList(value)
    .map((v) => Number(v))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** Extracts taxonomy names from a row for resolution before apply. */
export function extractTaxonomyNames(
  row: SyncSheetRow,
  allowedColumns?: string[]
): TaxonomyResolution {
  const all = !allowedColumns || allowedColumns.length === 0;
  const cols = new Set(allowedColumns ?? []);
  return {
    categoryIds: all || cols.has("categories_ids") ? parseIdList(row.categories_ids) : [],
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
  if (include("featured_image")) {
    const url = toText(row.featured_image);
    if (url) {
      const alt = toText(row.featured_image_alt_text);
      payload.image = { src: url, ...(alt ? { alt } : {}) };
    }
  }
  return payload;
}
