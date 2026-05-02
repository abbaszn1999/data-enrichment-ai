import type { SyncSheet, SyncSheetRow } from "../../core/types";
import { WOOCOMMERCE_CORE_PRODUCT_COLUMNS } from "./columns";

function toNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}
function toText(value: unknown) {
  return String(value ?? "").trim();
}

function getFeaturedImage(product: any) {
  if (Array.isArray(product?.images) && product.images.length > 0) {
    return product.images[0];
  }
  return null;
}

function getYoastMeta(product: any, key: string): string {
  const meta = Array.isArray(product?.meta_data) ? product.meta_data : [];
  const found = meta.find((m: any) => m?.key === key);
  return toText(found?.value);
}

/** Aggregate variation stats for a variable product. */
function collectVariationStats(variations: any[]) {
  const prices = variations.map((v) => toText(v?.regular_price)).filter(Boolean);
  const salePrices = variations.map((v) => toText(v?.sale_price)).filter(Boolean);
  const inventoryTotal = variations.reduce((sum, v) => sum + toNumber(v?.stock_quantity), 0);
  const primary = variations[0] ?? null;
  return {
    variation_id: toText(primary?.id),
    price: prices[0] || "",
    compare_at_price: salePrices[0] || "",
    inventory_total: inventoryTotal,
    primary_sku: toText(primary?.sku),
    barcode: toText(primary?.barcode),
    variant_count: variations.length,
  };
}

export function normalizeWooCommerceProductRow(product: any, variations: any[] = []): SyncSheetRow {
  const isVariable = product?.type === "variable" && variations.length > 0;
  const featuredImage = getFeaturedImage(product);

  let price = toText(product?.regular_price) || toText(product?.price);
  let comparePrice = toText(product?.sale_price);
  let inventoryTotal = toNumber(product?.stock_quantity);
  let primarySku = toText(product?.sku);
  let barcode = "";
  let variantCount = 0;
  let variationId = "";

  if (isVariable) {
    const stats = collectVariationStats(variations);
    price = stats.price || price;
    comparePrice = stats.compare_at_price || comparePrice;
    inventoryTotal = stats.inventory_total;
    primarySku = stats.primary_sku || primarySku;
    barcode = stats.barcode;
    variantCount = stats.variant_count;
    variationId = stats.variation_id;
  }

  const categories = Array.isArray(product?.categories)
    ? product.categories.map((c: any) => toText(c?.name)).filter(Boolean).join(", ")
    : "";
  const tags = Array.isArray(product?.tags)
    ? product.tags.map((t: any) => toText(t?.name)).filter(Boolean).join(", ")
    : "";

  return {
    id: toText(product?.id),
    title: toText(product?.name),
    handle: toText(product?.slug),
    status: toText(product?.status),
    type: toText(product?.type),
    vendor: "",
    product_type: toText(product?.type),
    tags,
    categories,
    price,
    compare_at_price: comparePrice,
    inventory_total: inventoryTotal,
    primary_sku: primarySku,
    barcode,
    manage_stock: Boolean(product?.manage_stock),
    stock_status: toText(product?.stock_status),
    variant_count: variantCount,
    variation_id: variationId,
    featured_image: toText(featuredImage?.src),
    featured_image_id: toText(featuredImage?.id),
    featured_image_alt_text: toText(featuredImage?.alt),
    short_description: toText(product?.short_description),
    body_html: toText(product?.description),
    weight: toText(product?.weight),
    seo_title: getYoastMeta(product, "_yoast_wpseo_title") || toText(product?.name),
    seo_description: getYoastMeta(product, "_yoast_wpseo_metadesc"),
    date_created: toText(product?.date_created),
    date_modified: toText(product?.date_modified),
  };
}

export function buildWooCommerceCoreProductsSheet(params: {
  integrationName: string;
  products: Array<{ product: any; variations: any[] }>;
}): SyncSheet {
  return {
    title: `Products · ${params.integrationName}`,
    columns: [...WOOCOMMERCE_CORE_PRODUCT_COLUMNS],
    rows: params.products.map((p) => normalizeWooCommerceProductRow(p.product, p.variations)),
  };
}
