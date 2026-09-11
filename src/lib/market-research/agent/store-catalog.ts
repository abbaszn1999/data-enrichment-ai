import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationRecord, ShopifyGraphQLResult } from "@/lib/sync/core/types";
import { fetchAllShopifyCollections } from "@/lib/sync/providers/shopify/collections";
import { shopifyGraphQL } from "@/lib/sync/providers/shopify/graphql-client";
import { fetchWooCommerceCategories } from "@/lib/sync/providers/woocommerce/categories";
import { createWooClient } from "@/lib/sync/providers/woocommerce/client";
import type { MarketResearchProduct } from "@/components/market-research/workspace-data";

// ─── Brand / vendor discovery ──────────────────────────────────────────────

const SHOPIFY_VENDORS_QUERY = /* GraphQL */ `
  query ProductVendorsPage($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        cursor
        node {
          vendor
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/** URL-safe id fragment for a brand/vendor pseudo-collection, e.g. "Ray-Ban" -> "ray-ban". */
function slugifyBrandName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "brand"
  );
}

/**
 * Walks every product in the store (paginated, uncapped) and tallies a real
 * product count per vendor in the same pass — no extra per-brand requests.
 * Each vendor becomes its own PLP-shaped item (`kind: "brand"`), treated by
 * every downstream stage exactly like a normal collection/category. This is
 * the store's complete brand roster; sampling or truncating it would
 * silently hide real, selectable brand pages from the merchant.
 */
type ShopifyVendorsResponse = {
  products: {
    edges: Array<{ cursor: string; node: { vendor?: string | null } }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

async function fetchShopifyVendors(
  integration: IntegrationRecord
): Promise<StoreCollectionItem[]> {
  const counts = new Map<string, number>();
  let after: string | null = null;
  let hasNextPage = true;
  let pages = 0;
  const MAX_PAGES = 80; // safety cap: 80 * 250 = 20,000 products

  while (hasNextPage && pages < MAX_PAGES) {
    const res: ShopifyGraphQLResult<ShopifyVendorsResponse> = await shopifyGraphQL<ShopifyVendorsResponse>({
      integration,
      query: SHOPIFY_VENDORS_QUERY,
      variables: { first: 250, after },
      options: { estimatedCost: 30, tag: "productVendors" },
    });

    const edges = res.data?.products?.edges ?? [];
    for (const edge of edges) {
      const vendor = edge.node?.vendor?.trim();
      if (vendor) counts.set(vendor, (counts.get(vendor) ?? 0) + 1);
    }

    if (edges.length === 0) break;

    hasNextPage = res.data?.products?.pageInfo?.hasNextPage ?? false;
    after = res.data?.products?.pageInfo?.endCursor ?? null;
    pages += 1;
  }

  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, productCount]) => {
      const handle = slugifyBrandName(name);
      return {
        id: `brand-${handle}`,
        name,
        handle,
        description: "",
        productCount,
        plpPath: "",
        published: true,
        kind: "brand" as const,
      };
    });
}

type WooAttribute = { id?: number; name?: string; slug?: string };
type WooAttributeTerm = { id?: number; name?: string; slug?: string; count?: number };
type WooBrandTerm = { id?: number; name?: string; slug?: string; count?: number };

/** Attribute names commonly used for the "Brand" field across WooCommerce stores. */
const BRAND_ATTRIBUTE_NAMES = [
  "brand",
  "brands",
  "vendor",
  "vendors",
  "manufacturer",
  "marque",
];

function wooBrandTermToItem(term: WooBrandTerm | WooAttributeTerm): StoreCollectionItem | null {
  const name = (term.name ?? "").trim();
  if (!name) return null;
  const handle = (term.slug ?? "").trim() || slugifyBrandName(name);
  return {
    id: `brand-${handle}`,
    name,
    handle,
    description: "",
    // WooCommerce term endpoints (both the brand taxonomy and attribute
    // terms) return a real `count` of products carrying that term — this is
    // the brand's true product count, not an estimate.
    productCount: Number(term.count) || 0,
    // Most brand-taxonomy plugins rewrite to /brand/<slug>/; left blank for
    // the plain-attribute fallback since there is no standard archive route.
    plpPath: "",
    published: true,
    kind: "brand",
  };
}

/**
 * WooCommerce has no single standard for brands. Most stores expose them one
 * of two ways:
 *   1. A dedicated brand taxonomy registered by a plugin (YITH / Perfect
 *      Brands / etc.), which mirrors the categories REST shape at
 *      `/products/brands` — including a real per-term `count`.
 *   2. A plain product attribute named "Brand" (`pa_brand`), whose terms live
 *      at `/products/attributes/{id}/terms` — the standard WP term shape,
 *      which also carries a real `count`.
 * Tries (1) first since it is purpose-built, falls back to (2), and returns
 * an empty list — never a thrown error — if the store has neither. Every
 * returned item is a full PLP-shaped `StoreCollectionItem` with a real
 * product count, treated identically to a category by every later stage.
 */
async function fetchWooBrands(
  integration: IntegrationRecord
): Promise<StoreCollectionItem[]> {
  const client = createWooClient(integration);

  // 1. Dedicated brand taxonomy endpoint, if a brands plugin is active.
  try {
    const brands: StoreCollectionItem[] = [];
    let page = 1;
    while (true) {
      const terms = await client.get<WooBrandTerm[]>("/products/brands", {
        per_page: 100,
        page,
      });
      if (!Array.isArray(terms) || terms.length === 0) break;
      for (const term of terms) {
        const item = wooBrandTermToItem(term);
        if (item) brands.push(item);
      }
      if (terms.length < 100) break;
      page += 1;
      if (page > 30) break; // safety cap
    }
    if (brands.length > 0) {
      return brands.sort((a, b) => a.name.localeCompare(b.name));
    }
  } catch {
    // No brands plugin registered on this store — fall through to attributes.
  }

  // 2. Plain "Brand" product attribute.
  try {
    const attributes = await client.get<WooAttribute[]>("/products/attributes", {
      per_page: 100,
    });
    if (!Array.isArray(attributes)) return [];

    const brandAttr = attributes.find((attr) => {
      const name = (attr.name ?? "").toLowerCase().trim();
      return BRAND_ATTRIBUTE_NAMES.some(
        (candidate) => name === candidate || name.includes(candidate)
      );
    });
    if (!brandAttr?.id) return [];

    const brands: StoreCollectionItem[] = [];
    let page = 1;
    while (true) {
      const terms = await client.get<WooAttributeTerm[]>(
        `/products/attributes/${brandAttr.id}/terms`,
        { per_page: 100, page }
      );
      if (!Array.isArray(terms) || terms.length === 0) break;
      for (const term of terms) {
        const item = wooBrandTermToItem(term);
        if (item) brands.push(item);
      }
      if (terms.length < 100) break;
      page += 1;
      if (page > 30) break; // safety cap
    }
    return brands.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("[fetchWooBrands] Failed to fetch brand attribute terms:", error);
    return [];
  }
}

/**
 * Derives each collection's hierarchy depth from its `parentId` chain and
 * writes it back onto the item in place. Top-level categories (parentId
 * missing or "0") are depth 0; every step down the parent chain adds 1.
 * Cycle-safe: a broken or circular parent chain resolves to 0 rather than
 * looping forever.
 */
function computeCollectionDepths(collections: StoreCollectionItem[]): void {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const resolved = new Map<string, number>();

  function resolveDepth(id: string, guard: number): number {
    if (guard > 25) return 0;
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;

    const item = byId.get(id);
    if (!item || !item.parentId || item.parentId === "0") {
      resolved.set(id, 0);
      return 0;
    }

    const depth = resolveDepth(item.parentId, guard + 1) + 1;
    resolved.set(id, depth);
    return depth;
  }

  for (const item of collections) {
    item.depth = resolveDepth(item.id, 0);
  }
}

export type StoreCollectionItem = {
  id: string;
  name: string;
  handle: string;
  description: string;
  productCount: number;
  plpPath: string;
  /**
   * False when the collection exists in the admin but is not on the storefront
   * sales channel, in which case its URL answers 404 and it must never be used
   * as an internal link target.
   */
  published?: boolean;
  /**
   * WooCommerce only. The parent category id ("0" = top-level). Shopify
   * collections are flat and never set this field.
   */
  parentId?: string;
  /**
   * WooCommerce only. 0 = top-level category, 1 = subcategory, 2 = sub-subcategory,
   * derived by walking the parentId chain. Shopify collections are always 0.
   */
  depth?: number;
  /**
   * "brand" marks a brand/vendor PLP (Shopify `vendor` filter page, or a
   * WooCommerce brand taxonomy/attribute archive) rather than a real
   * category or collection. Omitted (undefined) means "collection" — every
   * downstream stage treats a brand item exactly like any other collection
   * except for what its name is allowed to become (never a niche name).
   */
  kind?: "collection" | "brand";
};

export type StoreCatalogResult = {
  storeName: string;
  provider: string;
  baseUrl: string;
  isMock: boolean;
  collections: StoreCollectionItem[];
  /**
   * Every brand/vendor found on the store, each as a full PLP-shaped item
   * (`kind: "brand"`) with a real product count — the Shopify `vendor`
   * roster or the WooCommerce brand taxonomy/attribute terms. Not capped or
   * sampled. Empty array when the store has none. Callers typically merge
   * this straight into the `collections` list before niche discovery so
   * every stage treats a brand exactly like any other collection.
   */
  storeBrands: StoreCollectionItem[];
};

export type ScopeCollectionInput = {
  id: string;
  name: string;
  productCount?: number;
  parentNicheName?: string;
  description?: string;
};

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchStoreCatalog(
  admin: SupabaseClient,
  workspaceId: string
): Promise<StoreCatalogResult> {
  const { data: integrationRow } = await admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!integrationRow || !integrationRow.provider) {
    throw new Error(
      "No active store integration found for this workspace. Please connect Shopify or WooCommerce in Settings first."
    );
  }

  const integration = integrationRow as IntegrationRecord;
  const storeName = integration.integration_name || "Connected Store";
  const provider = String(integration.provider).toLowerCase();
  const baseUrl = integration.base_url || "";

  try {
    if (provider === "shopify") {
      const shopifyRows = await fetchAllShopifyCollections({ integration });
      const collections: StoreCollectionItem[] = shopifyRows.map((row) => {
        const id = String(row.id ?? "");
        const name = String(row.title ?? "");
        const handle = String(row.handle ?? "");
        const description = stripHtml(String(row.description ?? ""));
        const productCount = Number(row.products_count) || 0;
        const plpPath = handle ? `/collections/${handle}` : "";
        const publishedLabel = String(row.published ?? "");
        return {
          id: id || handle || name,
          name: name || handle,
          handle,
          description,
          productCount,
          plpPath,
          published:
            publishedLabel.length > 0 && publishedLabel !== "Not published",
        };
      });

      const storeBrands = await fetchShopifyVendors(integration).catch((error) => {
        console.error("[fetchStoreCatalog] Failed to fetch Shopify vendors:", error);
        return [] as StoreCollectionItem[];
      });
      return {
        storeName,
        provider: "shopify",
        baseUrl,
        isMock: false,
        collections,
        storeBrands,
      };
    }

    if (provider === "woocommerce" || provider === "wordpress") {
      const sheet = await fetchWooCommerceCategories({
        integration,
        limit: 5000,
      });
      const collections: StoreCollectionItem[] = sheet.rows.map((row) => {
        const id = String(row.id ?? "");
        const name = String(row.name ?? "");
        const handle = String(row.slug ?? "");
        const description = stripHtml(String(row.description ?? ""));
        const productCount = Number(row.count) || 0;
        const plpPath = handle ? `/product-category/${handle}` : "";
        const parentId = String(row.parent ?? 0);
        return {
          id: id || handle || name,
          name: name || handle,
          handle,
          description,
          productCount,
          plpPath,
          published: true,
          parentId,
        };
      });

      computeCollectionDepths(collections);

      const storeBrands = await fetchWooBrands(integration).catch((error) => {
        console.error("[fetchStoreCatalog] Failed to fetch WooCommerce brands:", error);
        return [] as StoreCollectionItem[];
      });
      return {
        storeName,
        provider: "woocommerce",
        baseUrl,
        isMock: false,
        collections,
        storeBrands,
      };
    }

    throw new Error(
      `Unsupported store provider "${provider}". Connect Shopify or WooCommerce in Settings.`
    );
  } catch (error) {
    console.error("[fetchStoreCatalog] Failed to fetch live collections:", error);
    throw error;
  }
}

const SHOPIFY_COLLECTION_PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query CollectionProductsPage($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      id
      title
      handle
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            handle
            descriptionHtml
            vendor
            productType
            tags
            totalInventory
            featuredMedia {
              ... on MediaImage {
                image { url altText }
              }
              preview { image { url } }
            }
            media(first: 6) {
              nodes {
                preview { image { url } }
              }
            }
            variants(first: 5) {
              nodes {
                id
                price
                compareAtPrice
                title
                selectedOptions { name value }
              }
            }
            options { name values }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// ─── Paginated, resumable product fetch ────────────────────────────────────
//
// A single GraphQL/REST page tops out at 250 (Shopify) / 100 (WooCommerce)
// products, and a store's selected collections can hold 20,000+ SKUs — far
// past what one request or one `maxDuration = 60` route call can pull. This
// walks collections in order, one page at a time, and returns a resumable
// cursor so the caller can drive it in a client-side loop (same pattern as
// the existing Apify extract poll) until every selected collection is fully
// paged or the global cap is hit.

/** Safety ceiling: no single project embeds/matches against more than this many SKUs. */
export const GLOBAL_PRODUCT_FETCH_CAP = 20_000;
const PRODUCT_FETCH_TIME_BUDGET_MS = 40_000;
const SHOPIFY_PRODUCTS_PAGE_SIZE = 250;
const WOO_PRODUCTS_PAGE_SIZE = 100;

export type ProductFetchCursorState = {
  /** Index into the caller's `selectedCollections` array of the collection currently paging. */
  collectionIndex: number;
  shopifyAfter: string | null;
  wooPage: number;
  totalFetched: number;
  perCollectionFetched: Record<string, number>;
  done: boolean;
};

export function initProductFetchCursor(): ProductFetchCursorState {
  return {
    collectionIndex: 0,
    shopifyAfter: null,
    wooPage: 1,
    totalFetched: 0,
    perCollectionFetched: {},
    done: false,
  };
}

type ShopifyProductNode = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  totalInventory?: number;
  featuredMedia?: {
    image?: { url: string };
    preview?: { image?: { url: string } };
  };
  media?: { nodes: Array<{ preview?: { image?: { url: string } } }> };
  variants?: {
    nodes: Array<{
      id: string;
      price: string;
      compareAtPrice?: string | null;
      title?: string;
    }>;
  };
  options?: Array<{ name: string; values: string[] }>;
};

function mapShopifyProductNode(
  p: ShopifyProductNode,
  col: ScopeCollectionInput,
  baseUrl: string
): MarketResearchProduct {
  const cleanDesc = stripHtml(p.descriptionHtml);
  const shortDesc =
    cleanDesc.length > 200 ? `${cleanDesc.slice(0, 197).trim()}...` : cleanDesc;

  const primaryImg =
    p.featuredMedia?.image?.url ||
    p.featuredMedia?.preview?.image?.url ||
    p.media?.nodes?.[0]?.preview?.image?.url ||
    "";

  const allImages: string[] = [];
  if (primaryImg) allImages.push(primaryImg);
  for (const m of p.media?.nodes ?? []) {
    const url = m.preview?.image?.url;
    if (url && !allImages.includes(url)) allImages.push(url);
  }

  const firstVar = p.variants?.nodes?.[0];
  const amount = Number(firstVar?.price) || 0;
  const compareAt = firstVar?.compareAtPrice
    ? Number(firstVar.compareAtPrice)
    : undefined;

  const attributes: Array<{ name: string; value: string }> = [];
  for (const opt of p.options ?? []) {
    if (opt.name && opt.values && opt.values.length > 0) {
      attributes.push({ name: opt.name, value: opt.values.join(", ") });
    }
  }

  return {
    id: p.id,
    title: p.title || "Untitled Product",
    handle: p.handle || "",
    url: p.handle ? `${baseUrl}/products/${p.handle}` : "",
    primaryImage: primaryImg,
    images: allImages,
    price: {
      amount,
      currency: "USD",
      compareAtPrice: compareAt,
      priceFormatted: `$${amount.toFixed(2)}`,
    },
    shortDescription: shortDesc,
    fullDescription: cleanDesc,
    vendor: p.vendor || "",
    productType: p.productType || "",
    tags: Array.isArray(p.tags) ? p.tags : [],
    attributes,
    collectionIds: [col.id],
    collectionNames: [col.name],
    inStock: (p.totalInventory ?? 1) > 0,
    totalInventory: p.totalInventory ?? undefined,
  };
}

function mapWooProductNode(
  p: Record<string, unknown>,
  col: ScopeCollectionInput,
  baseUrl: string
): MarketResearchProduct | null {
  const id = String(p.id ?? "");
  if (!id) return null;

  const cleanDesc = stripHtml(String(p.description ?? ""));
  const shortDesc =
    stripHtml(String(p.short_description ?? "")) || cleanDesc.slice(0, 180);

  const images = Array.isArray(p.images)
    ? (p.images as Array<{ src?: string }>).map((img) => img.src || "").filter(Boolean)
    : [];
  const primaryImg = images[0] || "";

  const amount = Number(p.price) || 0;
  const compareAt = p.regular_price ? Number(p.regular_price) : undefined;

  const attributes: Array<{ name: string; value: string }> = [];
  if (Array.isArray(p.attributes)) {
    for (const attr of p.attributes as Array<{ name?: string; options?: unknown }>) {
      if (attr.name) {
        const val = Array.isArray(attr.options)
          ? attr.options.join(", ")
          : String(attr.options ?? "");
        attributes.push({ name: attr.name, value: val });
      }
    }
  }

  const tags = Array.isArray(p.tags)
    ? (p.tags as Array<{ name?: string }>).map((t) => t.name || "").filter(Boolean)
    : [];

  return {
    id,
    title: String(p.name ?? "Untitled Product"),
    handle: String(p.slug ?? ""),
    url: String(p.permalink ?? (baseUrl ? `${baseUrl}/product/${p.slug}` : "")),
    primaryImage: primaryImg,
    images,
    price: {
      amount,
      currency: "USD",
      compareAtPrice: compareAt,
      priceFormatted: `$${amount.toFixed(2)}`,
    },
    shortDescription: shortDesc,
    fullDescription: cleanDesc,
    vendor: String(p.vendor ?? ""),
    productType: String(p.type ?? ""),
    tags,
    attributes,
    collectionIds: [col.id],
    collectionNames: [col.name],
    inStock: p.stock_status !== "outofstock",
    totalInventory: typeof p.stock_quantity === "number" ? p.stock_quantity : undefined,
  };
}

/**
 * Fetches one resumable "page" of products for the given cursor position —
 * as many pages as fit inside the time budget, advancing through
 * `selectedCollections` in order. Call again with the returned `cursor`
 * until `cursor.done` is true. Returns no products when the workspace has
 * no live store integration.
 */
export async function fetchStoreProductsPage(
  admin: SupabaseClient,
  workspaceId: string,
  selectedCollections: ScopeCollectionInput[],
  cursor: ProductFetchCursorState
): Promise<{ products: MarketResearchProduct[]; cursor: ProductFetchCursorState }> {
  if (!selectedCollections || selectedCollections.length === 0) {
    return { products: [], cursor: { ...cursor, done: true } };
  }

  const { data: integrationRow } = await admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!integrationRow || !integrationRow.provider) {
    return { products: [], cursor: { ...cursor, done: true } };
  }

  const integration = integrationRow as IntegrationRecord;
  const provider = String(integration.provider).toLowerCase();
  const baseUrl = (integration.base_url || "").replace(/\/+$/, "");

  const next: ProductFetchCursorState = {
    ...cursor,
    perCollectionFetched: { ...cursor.perCollectionFetched },
  };
  const collected: MarketResearchProduct[] = [];
  const startedAt = Date.now();

  while (
    next.collectionIndex < selectedCollections.length &&
    next.totalFetched < GLOBAL_PRODUCT_FETCH_CAP &&
    Date.now() - startedAt < PRODUCT_FETCH_TIME_BUDGET_MS
  ) {
    const col = selectedCollections[next.collectionIndex];

    try {
      if (provider === "shopify") {
        const colGid = col.id.startsWith("gid://")
          ? col.id
          : `gid://shopify/Collection/${col.id}`;

        const res = await shopifyGraphQL<{
          collection: { products: { edges: Array<{ node: ShopifyProductNode }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null;
        }>({
          integration,
          query: SHOPIFY_COLLECTION_PRODUCTS_PAGE_QUERY,
          variables: { id: colGid, first: SHOPIFY_PRODUCTS_PAGE_SIZE, after: next.shopifyAfter },
          options: { estimatedCost: 35, tag: "collectionProducts" },
        });

        const edges = res.data?.collection?.products?.edges ?? [];
        for (const edge of edges) {
          if (edge.node?.id) collected.push(mapShopifyProductNode(edge.node, col, baseUrl));
        }
        next.totalFetched += edges.length;
        next.perCollectionFetched[col.id] = (next.perCollectionFetched[col.id] ?? 0) + edges.length;

        const pageInfo = res.data?.collection?.products?.pageInfo;
        if (pageInfo?.hasNextPage && edges.length > 0) {
          next.shopifyAfter = pageInfo.endCursor ?? null;
        } else {
          next.collectionIndex += 1;
          next.shopifyAfter = null;
        }
      } else if (provider === "woocommerce" || provider === "wordpress") {
        const client = createWooClient(integration);
        const resp = await client.requestRaw("/products", {
          method: "GET",
          query: { category: col.id, per_page: WOO_PRODUCTS_PAGE_SIZE, page: next.wooPage, status: "publish" },
        });
        const list = (await resp.json().catch(() => [])) as Array<Record<string, unknown>>;
        const rows = Array.isArray(list) ? list : [];
        for (const p of rows) {
          const mapped = mapWooProductNode(p, col, baseUrl);
          if (mapped) collected.push(mapped);
        }
        next.totalFetched += rows.length;
        next.perCollectionFetched[col.id] = (next.perCollectionFetched[col.id] ?? 0) + rows.length;

        if (rows.length < WOO_PRODUCTS_PAGE_SIZE) {
          next.collectionIndex += 1;
          next.wooPage = 1;
        } else {
          next.wooPage += 1;
        }
      } else {
        // Unknown provider: nothing more to page, close out this collection.
        next.collectionIndex += 1;
      }
    } catch (err) {
      console.error(
        `[fetchStoreProductsPage] Failed for collection ${col.id}, skipping it:`,
        err
      );
      next.collectionIndex += 1;
      next.shopifyAfter = null;
      next.wooPage = 1;
    }
  }

  next.done = next.collectionIndex >= selectedCollections.length || next.totalFetched >= GLOBAL_PRODUCT_FETCH_CAP;

  return { products: collected, cursor: next };
}

export function generateMockProductsForCollections(
  selectedCollections: ScopeCollectionInput[],
  storeName = "Demo Store"
): MarketResearchProduct[] {
  const products: MarketResearchProduct[] = [];
  let seq = 100;

  for (const col of selectedCollections) {
    const nameLower = col.name.toLowerCase();
    const nicheLower = (col.parentNicheName || "").toLowerCase();

    if (nameLower.includes("stylus") || nameLower.includes("pen")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "Pro Pen Stylus Tablet X1 12.4\"",
          handle: "pro-pen-stylus-tablet-x1",
          url: `/products/pro-pen-stylus-tablet-x1`,
          primaryImage:
            "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
            "https://images.unsplash.com/photo-1585770634629-d5a2d659ad76?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 799,
            currency: "USD",
            compareAtPrice: 899,
            priceFormatted: "$799.00",
          },
          shortDescription:
            "12.4-inch 120Hz display with magnetic low-latency active stylus, 256GB storage, and 14-hour battery life.",
          fullDescription:
            "Engineered for digital artists and professionals, the Pro Pen Stylus Tablet X1 delivers ultra-precise pressure sensitivity with 4,096 levels of pen tracking and palm rejection.",
          vendor: storeName,
          productType: "Tablet",
          tags: ["stylus", "drawing", "tablet", "creativity", "touchscreen"],
          attributes: [
            { name: "Screen Size", value: "12.4-inch OLED" },
            { name: "Storage", value: "256GB, 512GB" },
            { name: "Stylus Included", value: "Yes (4096 pressure levels)" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 42,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "UltraTab Creator Pro with Stylus & Stand",
          handle: "ultratab-creator-pro",
          url: `/products/ultratab-creator-pro`,
          primaryImage:
            "https://images.unsplash.com/photo-1585770634629-d5a2d659ad76?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1585770634629-d5a2d659ad76?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 649,
            currency: "USD",
            compareAtPrice: 729,
            priceFormatted: "$649.00",
          },
          shortDescription:
            "High-precision stylus tablet with anti-glare laminated glass and customizable shortcut ring.",
          fullDescription:
            "Designed for sketching, note-taking, and digital illustration with 8ms pen response time and tilt sensitivity.",
          vendor: storeName,
          productType: "Drawing Tablet",
          tags: ["drawing tablet", "stylus", "artist", "pen display"],
          attributes: [
            { name: "Screen Size", value: "11.6-inch IPS" },
            { name: "Pen Tilt", value: "±60 Degrees" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 28,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "NotePad Air Stylus Edition 10.9\"",
          handle: "notepad-air-stylus-edition",
          url: `/products/notepad-air-stylus-edition`,
          primaryImage:
            "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 499,
            currency: "USD",
            priceFormatted: "$499.00",
          },
          shortDescription:
            "Lightweight daily tablet with magnetic wireless charging stylus for seamless note-taking.",
          fullDescription:
            "The perfect digital notebook for students and executives. Features instant palm rejection, paper-feel screen protector, and cloud sync.",
          vendor: storeName,
          productType: "Tablet",
          tags: ["notepad", "stylus tablet", "portable", "notes"],
          attributes: [
            { name: "Screen Size", value: "10.9-inch Liquid Retina" },
            { name: "Weight", value: "460g" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 55,
        }
      );
    } else if (nameLower.includes("tablet")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "GalaxyPad Ultra 12.4\" 5G",
          handle: "galaxypad-ultra-12-4-5g",
          url: `/products/galaxypad-ultra-12-4-5g`,
          primaryImage:
            "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 849,
            currency: "USD",
            compareAtPrice: 999,
            priceFormatted: "$849.00",
          },
          shortDescription:
            "Flagship 120Hz AMOLED tablet with octa-core processor, dual cameras, and all-day battery.",
          fullDescription:
            "Ultimate productivity tablet featuring multi-window split screen, high fidelity quad speakers tuned by Dolby Atmos, and fast charging.",
          vendor: storeName,
          productType: "Tablet",
          tags: ["tablet", "5g", "amoled", "multimedia"],
          attributes: [
            { name: "Screen", value: "12.4\" AMOLED 120Hz" },
            { name: "Storage", value: "256GB" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 30,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "CompactPad Mini 8.4\" Wi-Fi",
          handle: "compactpad-mini-8-4-wifi",
          url: `/products/compactpad-mini-8-4-wifi`,
          primaryImage:
            "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 329,
            currency: "USD",
            priceFormatted: "$329.00",
          },
          shortDescription:
            "One-handed compact entertainment tablet with 2K display and dual stereo speakers.",
          fullDescription:
            "Ultra-lightweight pocket tablet ideal for reading, streaming, gaming on the go with lightweight aluminum body.",
          vendor: storeName,
          productType: "Tablet",
          tags: ["compact tablet", "mini", "ereader", "wifi"],
          attributes: [
            { name: "Screen", value: "8.4\" 2K Retina" },
            { name: "Weight", value: "295g" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 60,
        }
      );
    } else if (nameLower.includes("phone") || nameLower.includes("smartphone")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "Apex Pro 5G Flagship Smartphone 256GB",
          handle: "apex-pro-5g-smartphone",
          url: `/products/apex-pro-5g-smartphone`,
          primaryImage:
            "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 999,
            currency: "USD",
            compareAtPrice: 1099,
            priceFormatted: "$999.00",
          },
          shortDescription:
            "6.7-inch OLED 144Hz display, 200MP AI camera system, and 5000mAh battery.",
          fullDescription:
            "Unrivaled photography with cinematic 8K recording, periscope zoom lens, and ultra-fast next-gen chip.",
          vendor: storeName,
          productType: "Smartphone",
          tags: ["5g", "smartphone", "flagship", "camera phone"],
          attributes: [
            { name: "Storage", value: "256GB / 512GB" },
            { name: "Color", value: "Midnight Black, Titanium Silver" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 50,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "Nova Ultra Compact Smartphone 128GB",
          handle: "nova-ultra-compact-smartphone",
          url: `/products/nova-ultra-compact-smartphone`,
          primaryImage:
            "https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 649,
            currency: "USD",
            priceFormatted: "$649.00",
          },
          shortDescription:
            "Sleek 6.1-inch ergonomics with flagship dual cameras and durable ceramic shield glass.",
          fullDescription:
            "Pocket-friendly performance with fast wireless charging, IP68 water resistance, and vivid HDR screen.",
          vendor: storeName,
          productType: "Smartphone",
          tags: ["compact phone", "smartphone", "dual camera"],
          attributes: [
            { name: "Storage", value: "128GB" },
            { name: "Display", value: "6.1-inch Super Retina" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 35,
        }
      );
    } else if (nameLower.includes("laptop")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "QuantumBook Pro 15.6\" Creator Laptop",
          handle: "quantumbook-pro-15",
          url: `/products/quantumbook-pro-15`,
          primaryImage:
            "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 1499,
            currency: "USD",
            compareAtPrice: 1699,
            priceFormatted: "$1,499.00",
          },
          shortDescription:
            "15.6\" 4K Mini-LED display, 32GB RAM, 1TB NVMe SSD, and dedicated RTX graphics.",
          fullDescription:
            "Built for 3D rendering, video editing, and demanding workloads with thermal vapor chamber cooling.",
          vendor: storeName,
          productType: "Laptop",
          tags: ["laptop", "creator", "4k", "rtx"],
          attributes: [
            { name: "RAM", value: "32GB DDR5" },
            { name: "GPU", value: "RTX 4070" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 20,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "AeroLite Ultrabook 14\" Thin & Light",
          handle: "aerolite-ultrabook-14",
          url: `/products/aerolite-ultrabook-14`,
          primaryImage:
            "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 999,
            currency: "USD",
            priceFormatted: "$999.00",
          },
          shortDescription:
            "0.98kg carbon fiber chassis with 18-hour battery and bright 2.8K 90Hz OLED panel.",
          fullDescription:
            "The ultimate travel laptop for remote professionals and students. Silent fanless design with backlit keyboard.",
          vendor: storeName,
          productType: "Laptop",
          tags: ["ultrabook", "lightweight", "oled", "portable"],
          attributes: [
            { name: "Weight", value: "0.98 kg" },
            { name: "Battery Life", value: "Up to 18 hours" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 40,
        }
      );
    } else if (nameLower.includes("headphone") || nameLower.includes("audio")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "StudioSense Wireless Over-Ear ANC Headphones",
          handle: "studiosense-wireless-anc-headphones",
          url: `/products/studiosense-wireless-anc-headphones`,
          primaryImage:
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 299,
            currency: "USD",
            compareAtPrice: 349,
            priceFormatted: "$299.00",
          },
          shortDescription:
            "Active Hybrid Noise Cancelling, 40mm custom beryllium drivers, and 45h playtime.",
          fullDescription:
            "Immerse yourself in rich acoustic precision with spatial audio head tracking, memory foam ear cups, and multipoint Bluetooth 5.4.",
          vendor: storeName,
          productType: "Headphones",
          tags: ["headphones", "anc", "wireless", "over-ear", "audio"],
          attributes: [
            { name: "Driver Size", value: "40mm Beryllium" },
            { name: "Battery Life", value: "45 Hours (ANC On)" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 75,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "AcousticPro Studio Monitoring Headphones",
          handle: "acousticpro-studio-monitoring-headphones",
          url: `/products/acousticpro-studio-monitoring-headphones`,
          primaryImage:
            "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 179,
            currency: "USD",
            priceFormatted: "$179.00",
          },
          shortDescription:
            "Open-back reference headphones with planar magnetic accuracy and detachable gold-plated cable.",
          fullDescription:
            "Mastering-grade sonic transparency for music producers, sound designers, and audiophiles seeking flat frequency response.",
          vendor: storeName,
          productType: "Headphones",
          tags: ["studio monitor", "open back", "audiophile", "wired"],
          attributes: [
            { name: "Type", value: "Open-Back Planar" },
            { name: "Impedance", value: "32 Ohms" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 30,
        }
      );
    } else if (nameLower.includes("watch")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "PulseFit Active Smartwatch GPS Titanium",
          handle: "pulsefit-active-smartwatch-titanium",
          url: `/products/pulsefit-active-smartwatch-titanium`,
          primaryImage:
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 349,
            currency: "USD",
            compareAtPrice: 399,
            priceFormatted: "$349.00",
          },
          shortDescription:
            "Dual-frequency GPS, ECG heart monitor, sapphire crystal glass, and 100m water resistance.",
          fullDescription:
            "Rugged outdoor smartwatch engineered for endurance athletes and everyday health tracking with 14-day battery life.",
          vendor: storeName,
          productType: "Smartwatch",
          tags: ["smartwatch", "gps", "fitness tracker", "titanium"],
          attributes: [
            { name: "Case Material", value: "Grade 5 Titanium" },
            { name: "Battery", value: "14 Days" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 45,
        }
      );
    } else if (nameLower.includes("sunglass") || nicheLower.includes("eyewear")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "Aero Aviator Polarized Sunglasses Matte Gold",
          handle: "aero-aviator-polarized-sunglasses",
          url: `/products/aero-aviator-polarized-sunglasses`,
          primaryImage:
            "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 145,
            currency: "USD",
            compareAtPrice: 175,
            priceFormatted: "$145.00",
          },
          shortDescription:
            "Classic teardrop aviator frame with UV400 polarized HD mineral lenses and spring hinges.",
          fullDescription:
            "Crafted with lightweight corrosion-resistant alloy and premium anti-reflective coating for glare-free driving and outdoor clarity.",
          vendor: storeName,
          productType: "Sunglasses",
          tags: ["sunglasses", "polarized", "aviator", "eyewear"],
          attributes: [
            { name: "Frame Color", value: "Matte Gold" },
            { name: "Lens", value: "Polarized Green G-15" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 80,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "Classic Wayfarer Tortoise Polarized Frames",
          handle: "classic-wayfarer-tortoise-sunglasses",
          url: `/products/classic-wayfarer-tortoise-sunglasses`,
          primaryImage:
            "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 129,
            currency: "USD",
            priceFormatted: "$129.00",
          },
          shortDescription:
            "Handcrafted Italian acetate frames with amber polarized lenses for warm natural contrast.",
          fullDescription:
            "Timeless silhouette designed for everyday elegance with 100% UVA/UVB protection and scratch-resistant treatment.",
          vendor: storeName,
          productType: "Sunglasses",
          tags: ["sunglasses", "wayfarer", "tortoise", "acetate"],
          attributes: [
            { name: "Frame Material", value: "Italian Acetate" },
            { name: "Lens", value: "Amber Polarized UV400" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 65,
        }
      );
    } else {
      // Generic high quality product based on collection name
      const cleanCol = col.name.replace(/^AI\s*-\s*/i, "");
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: `Premium Pro ${cleanCol} Model V1`,
          handle: `premium-pro-${col.id}-model-v1`,
          url: `/products/premium-pro-${col.id}-model-v1`,
          primaryImage:
            "https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 199,
            currency: "USD",
            compareAtPrice: 249,
            priceFormatted: "$199.00",
          },
          shortDescription: `Top rated ${cleanCol.toLowerCase()} designed with premium materials and industry-leading performance.`,
          fullDescription: `Engineered for excellence, this ${cleanCol.toLowerCase()} delivers superior reliability, elegant design, and seamless user experience.`,
          vendor: storeName,
          productType: col.name,
          tags: [cleanCol.toLowerCase(), "premium", "top-rated"],
          attributes: [
            { name: "Grade", value: "Professional" },
            { name: "Warranty", value: "2 Years" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 50,
        },
        {
          id: `demo-prod-${++seq}`,
          title: `Ultra Edition ${cleanCol} Compact`,
          handle: `ultra-edition-${col.id}-compact`,
          url: `/products/ultra-edition-${col.id}-compact`,
          primaryImage:
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 129,
            currency: "USD",
            priceFormatted: "$129.00",
          },
          shortDescription: `Lightweight and versatile ${cleanCol.toLowerCase()} built for everyday durability.`,
          fullDescription: `Compact form factor featuring robust build quality, ergonomic handling, and high-efficiency specs.`,
          vendor: storeName,
          productType: col.name,
          tags: [cleanCol.toLowerCase(), "compact", "durable"],
          attributes: [
            { name: "Design", value: "Ergonomic Slim" },
            { name: "Color", value: "Obsidian Black" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 35,
        }
      );
    }
  }

  return products;
}

export function getFallbackStoreCatalog(storeName = "Demo Store"): StoreCatalogResult {
  return {
    storeName,
    provider: "none",
    baseUrl: "",
    isMock: true,
    collections: [],
    storeBrands: [],
  };
}
