import type { SyncSheet, SyncSheetRow } from "../../core/types";
import { SHOPIFY_CORE_PRODUCT_COLUMNS } from "./columns";

function toNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function toText(value: unknown) {
  return String(value ?? "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL 2026-04 normalization
// ─────────────────────────────────────────────────────────────────────────────

type GqlProductNode = {
  id?: string;
  title?: string;
  handle?: string;
  status?: string;
  vendor?: string;
  productType?: string;
  descriptionHtml?: string;
  tags?: string[];
  seo?: { title?: string | null; description?: string | null } | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  totalInventory?: number | null;
  variantsCount?: { count?: number } | null;
  featuredMedia?: {
    id?: string;
    alt?: string | null;
    preview?: { image?: { url?: string } } | null;
  } | null;
  media?: { edges?: Array<{ node?: { id?: string } }>; nodes?: Array<{ id?: string }> } | null;
  variants?: {
    edges?: Array<{ node?: GqlVariantNode }>;
    nodes?: Array<GqlVariantNode>;
  } | null;
  collections?: {
    edges?: Array<{ node?: { id?: string; title?: string; handle?: string } }>;
    nodes?: Array<{ id?: string; title?: string; handle?: string }>;
  } | null;
  metafields?: {
    edges?: Array<{ node?: GqlMetafieldNode }>;
    nodes?: Array<GqlMetafieldNode>;
  } | null;
};

type GqlVariantNode = {
  id?: string;
  sku?: string | null;
  barcode?: string | null;
  price?: string | null;
  compareAtPrice?: string | null;
  inventoryQuantity?: number | null;
  inventoryPolicy?: string | null;
  inventoryItem?: { id?: string } | null;
};

type GqlMetafieldNode = {
  id?: string;
  namespace?: string;
  key?: string;
  value?: string;
  type?: string;
};

function extractNodes<T>(connection: { nodes?: T[]; edges?: Array<{ node?: T }> } | null | undefined): T[] {
  if (!connection) return [];
  if (Array.isArray(connection.nodes)) return connection.nodes.filter(Boolean) as T[];
  if (Array.isArray(connection.edges)) {
    return connection.edges.map((e) => e?.node).filter(Boolean) as T[];
  }
  return [];
}

function collectGqlVariantStats(variants: GqlVariantNode[]) {
  const prices = variants.map((v) => toText(v?.price)).filter(Boolean);
  const compareAtPrices = variants.map((v) => toText(v?.compareAtPrice)).filter(Boolean);
  const inventoryTotal = variants.reduce((sum, v) => sum + toNumber(v?.inventoryQuantity), 0);
  const primary = variants[0] ?? null;
  return {
    variant_id: toText(primary?.id),
    inventory_item_id: toText(primary?.inventoryItem?.id),
    price: prices[0] || "",
    compare_at_price: compareAtPrices[0] || "",
    inventory_total: inventoryTotal,
    primary_sku: toText(primary?.sku),
    barcode: toText(primary?.barcode),
    inventory_policy: toText(primary?.inventoryPolicy),
    variant_count: variants.length,
  };
}

export function normalizeShopifyGqlProduct(product: GqlProductNode): SyncSheetRow {
  const variants = extractNodes<GqlVariantNode>(product.variants ?? null);
  const vs = collectGqlVariantStats(variants);
  const collections = extractNodes(product.collections ?? null);
  const metafields = extractNodes<GqlMetafieldNode>(product.metafields ?? null);
  const mediaNodes = extractNodes(product.media ?? null);
  const featuredImg = product.featuredMedia?.preview?.image?.url;

  const row: SyncSheetRow = {
    id: toText(product?.id),
    title: toText(product?.title),
    handle: toText(product?.handle),
    status: toText(product?.status),
    vendor: toText(product?.vendor),
    product_type: toText(product?.productType),
    tags: Array.isArray(product?.tags)
      ? product.tags.map(toText).filter(Boolean).join(", ")
      : toText(product?.tags),
    variant_id: vs.variant_id,
    inventory_item_id: vs.inventory_item_id,
    price: vs.price,
    compare_at_price: vs.compare_at_price,
    inventory_total:
      product.totalInventory != null ? toNumber(product.totalInventory) : vs.inventory_total,
    primary_sku: vs.primary_sku,
    barcode: vs.barcode,
    inventory_policy: vs.inventory_policy,
    variant_count: product.variantsCount?.count ?? vs.variant_count,
    featured_image: toText(featuredImg),
    featured_image_id: toText(product.featuredMedia?.id),
    featured_image_alt_text: toText(product.featuredMedia?.alt),
    image_count: mediaNodes.length,
    body_html: toText(product?.descriptionHtml),
    seo_title: toText(product?.seo?.title),
    seo_description: toText(product?.seo?.description),
    published_at: toText(product?.publishedAt),
    created_at: toText(product?.createdAt),
    updated_at: toText(product?.updatedAt),
    collections: collections.map((c) => toText(c?.title)).filter(Boolean).join(", "),
    collections_ids: collections.map((c) => toText(c?.id)).filter(Boolean),
  };

  // Dynamic metafield columns: metafields_<namespace>_<key>
  for (const mf of metafields) {
    const ns = toText(mf?.namespace);
    const key = toText(mf?.key);
    if (!ns || !key) continue;
    row[`metafields_${ns}_${key}`] = toText(mf?.value);
  }

  return row;
}

/** Column list including dynamic metafield columns present in any row. */
export function buildDynamicColumnList(rows: SyncSheetRow[]): string[] {
  const staticCols = [...SHOPIFY_CORE_PRODUCT_COLUMNS, "image_count", "collections"] as string[];
  const extra = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!staticCols.includes(k) && (k.startsWith("metafields_") || k === "collections_ids")) {
        extra.add(k);
      }
    }
  }
  return [...staticCols, ...Array.from(extra)];
}

export function buildShopifyGqlProductsSheet(params: {
  integrationName: string;
  products: GqlProductNode[];
}): SyncSheet {
  const rows = params.products.map(normalizeShopifyGqlProduct);
  return {
    title: `Products · ${params.integrationName}`,
    columns: buildDynamicColumnList(rows),
    rows,
  };
}

function getFeaturedImage(product: any) {
  const directImage = product?.image;
  if (toText(directImage?.src)) return directImage;
  if (Array.isArray(product?.images)) {
    return product.images.find((image: any) => toText(image?.src)) ?? null;
  }
  return null;
}

function collectVariantStats(variants: any[]) {
  const prices = variants.map((v) => toText(v?.price)).filter(Boolean);
  const compareAtPrices = variants.map((v) => toText(v?.compare_at_price)).filter(Boolean);
  const inventoryTotal = variants.reduce((sum, v) => sum + toNumber(v?.inventory_quantity), 0);
  const primaryVariant = variants[0] ?? null;

  return {
    variant_id: toText(primaryVariant?.id),
    inventory_item_id: toText(primaryVariant?.inventory_item_id),
    price: prices[0] || "",
    compare_at_price: compareAtPrices[0] || "",
    inventory_total: inventoryTotal,
    primary_sku: toText(primaryVariant?.sku),
    barcode: toText(primaryVariant?.barcode),
    inventory_policy: toText(primaryVariant?.inventory_policy),
    variant_count: variants.length,
  };
}

export function normalizeShopifyProductRow(product: any): SyncSheetRow {
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
  };
}

export function buildShopifyCoreProductsSheet(params: {
  integrationName: string;
  products: any[];
}): SyncSheet {
  return {
    title: `Products · ${params.integrationName}`,
    columns: [...SHOPIFY_CORE_PRODUCT_COLUMNS],
    rows: params.products.map((p) => normalizeShopifyProductRow(p)),
  };
}
