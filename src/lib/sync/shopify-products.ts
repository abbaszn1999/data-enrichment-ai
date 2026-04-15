export type SyncSheetRow = Record<string, unknown>;

export type SyncSheet = {
  title: string;
  columns: string[];
  rows: SyncSheetRow[];
};

export const SHOPIFY_CORE_PRODUCT_COLUMNS = [
  "id",
  "title",
  "handle",
  "status",
  "vendor",
  "product_type",
  "tags",
  "price",
  "compare_at_price",
  "inventory_total",
  "primary_sku",
  "barcode",
  "inventory_policy",
  "variant_count",
  "featured_image",
  "featured_image_alt_text",
  "body_html",
  "seo_title",
  "seo_description",
  "published_at",
  "created_at",
  "updated_at",
] as const;

function toNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function toText(value: unknown) {
  return String(value ?? "").trim();
}

function getFeaturedImage(product: any) {
  const directImage = product?.image;
  if (toText(directImage?.src)) {
    return directImage;
  }

  if (Array.isArray(product?.images)) {
    return product.images.find((image: any) => toText(image?.src)) ?? null;
  }

  return null;
}

function collectVariantStats(variants: any[]) {
  const prices = variants
    .map((variant) => toText(variant?.price))
    .filter((value) => value.length > 0);

  const compareAtPrices = variants
    .map((variant) => toText(variant?.compare_at_price))
    .filter((value) => value.length > 0);

  const inventoryTotal = variants.reduce((sum, variant) => sum + toNumber(variant?.inventory_quantity), 0);
  const primaryVariant = variants[0] ?? null;
  const primarySku = toText(primaryVariant?.sku);

  return {
    variant_id: toText(primaryVariant?.id),
    inventory_item_id: toText(primaryVariant?.inventory_item_id),
    price: prices[0] || "",
    compare_at_price: compareAtPrices[0] || "",
    inventory_total: inventoryTotal,
    primary_sku: primarySku,
    barcode: toText(primaryVariant?.barcode),
    inventory_policy: toText(primaryVariant?.inventory_policy),
    variant_count: variants.length,
  };
}

export function normalizeShopifyProductRow(product: any) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variantStats = collectVariantStats(variants);
  const featuredImage = getFeaturedImage(product);

  return {
    id: toText(product?.id),
    title: toText(product?.title),
    handle: toText(product?.handle),
    status: toText(product?.status),
    vendor: toText(product?.vendor),
    product_type: toText(product?.product_type),
    tags: Array.isArray(product?.tags)
      ? product.tags.map((tag: unknown) => toText(tag)).filter(Boolean).join(", ")
      : toText(product?.tags),
    variant_id: variantStats.variant_id,
    inventory_item_id: variantStats.inventory_item_id,
    price: variantStats.price,
    compare_at_price: variantStats.compare_at_price,
    inventory_total: variantStats.inventory_total,
    primary_sku: variantStats.primary_sku,
    barcode: variantStats.barcode,
    inventory_policy: variantStats.inventory_policy,
    variant_count: variantStats.variant_count,
    featured_image: toText(featuredImage?.src),
    featured_image_id: toText(featuredImage?.id),
    featured_image_alt_text: toText(featuredImage?.alt),
    body_html: toText(product?.body_html),
    seo_title: toText(product?.seo_title),
    seo_description: toText(product?.seo_description),
    published_at: toText(product?.published_at),
    created_at: toText(product?.created_at),
    updated_at: toText(product?.updated_at),
  } satisfies SyncSheetRow;
}

export function buildShopifyCoreProductsSheet(params: {
  integrationName: string;
  products: any[];
}): SyncSheet {
  return {
    title: `Products · ${params.integrationName}`,
    columns: [...SHOPIFY_CORE_PRODUCT_COLUMNS],
    rows: params.products.map((product) => normalizeShopifyProductRow(product)),
  };
}
