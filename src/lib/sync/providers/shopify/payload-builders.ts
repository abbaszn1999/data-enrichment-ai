import type { SyncSheetRow } from "../../core/types";
import { SHOPIFY_SYNCABLE_COLUMN_MAP } from "./columns";

function toNormalizedText(value: unknown) {
  return String(value ?? "").trim();
}

export function buildShopifyProductPayload(row: SyncSheetRow, allowedColumns?: string[]) {
  const payload: Record<string, unknown> = {};
  const columnsToUse = allowedColumns && allowedColumns.length > 0
    ? allowedColumns.filter((column) => column in SHOPIFY_SYNCABLE_COLUMN_MAP)
    : Object.keys(SHOPIFY_SYNCABLE_COLUMN_MAP);

  for (const column of columnsToUse) {
    const targetField = SHOPIFY_SYNCABLE_COLUMN_MAP[column];
    if (!targetField) continue;
    const value = row[column];
    if (value === undefined) continue;

    if (column === "handle") {
      const normalizedHandle = String(value ?? "").trim();
      if (normalizedHandle) payload[targetField] = normalizedHandle;
      continue;
    }
    payload[targetField] = String(value ?? "").trim();
  }
  return payload;
}

export function buildShopifyVariantPayload(row: SyncSheetRow, allowedColumns?: string[]) {
  const columns = new Set(allowedColumns ?? []);
  const shouldIncludeAll = !allowedColumns || allowedColumns.length === 0;
  const variant: Record<string, unknown> = {};

  if (shouldIncludeAll || columns.has("price")) {
    const price = toNormalizedText(row.price);
    if (price) variant.price = price;
  }
  if (shouldIncludeAll || columns.has("compare_at_price")) {
    const compareAtPrice = toNormalizedText(row.compare_at_price);
    if (compareAtPrice) variant.compare_at_price = compareAtPrice;
  }
  if (shouldIncludeAll || columns.has("primary_sku")) {
    const sku = toNormalizedText(row.primary_sku);
    if (sku) variant.sku = sku;
  }
  if (shouldIncludeAll || columns.has("barcode")) {
    variant.barcode = toNormalizedText(row.barcode);
  }
  if (shouldIncludeAll || columns.has("inventory_policy")) {
    const inventoryPolicy = toNormalizedText(row.inventory_policy);
    if (inventoryPolicy === "continue" || inventoryPolicy === "deny") {
      variant.inventory_policy = inventoryPolicy;
    }
  }
  return variant;
}

export function buildShopifyImagePayload(row: SyncSheetRow, allowedColumns?: string[]) {
  const shouldIncludeAll = !allowedColumns || allowedColumns.length === 0;
  const shouldIncludeFeaturedImage = shouldIncludeAll || allowedColumns.includes("featured_image");
  if (!shouldIncludeFeaturedImage) return null;
  const featuredImage = toNormalizedText(row.featured_image);
  if (!featuredImage) return null;
  return [{ src: featuredImage }];
}
