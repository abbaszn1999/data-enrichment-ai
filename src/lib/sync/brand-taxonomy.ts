// Shared brand/vendor PLP discovery — a store's brand pages are real,
// selectable taxonomy groups with real product counts, but neither Shopify
// nor WooCommerce exposes them through the normal collection/category
// endpoints (`ProviderTaxonomy.list`). Market Research and Website
// Restructure both need this exact same roster (Market Research to classify
// brand PLPs into niches, Website Restructure to elect brand pillars like
// "Gucci" for the header), so it lives here once instead of twice.

import type { IntegrationRecord, ShopifyGraphQLResult } from "./core/types";
import { shopifyGraphQL } from "./providers/shopify/graphql-client";
import { createWooClient } from "./providers/woocommerce/client";

export type BrandTaxonomyItem = {
  id: string;
  name: string;
  handle: string;
  productCount: number;
};

export type BrandFetchOptions = {
  /** Hard ceiling on product pages walked (Shopify). */
  maxPages?: number;
  /**
   * Wall-clock budget. When it runs out the walk stops and returns the
   * brands found so far rather than throwing — a partial roster (real names,
   * product counts that are lower bounds) is far better for a time-boxed
   * caller than losing the whole request. Callers with a long budget of
   * their own (Market Research) leave this unset and get the full roster.
   */
  timeBudgetMs?: number;
};

/** URL-safe id fragment for a brand/vendor pseudo-collection, e.g. "Ray-Ban" -> "ray-ban". */
export function slugifyBrandName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "brand"
  );
}

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

type ShopifyVendorsResponse = {
  products: {
    edges: Array<{ cursor: string; node: { vendor?: string | null } }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

/**
 * Walks products in the store (paginated, capped at `maxPages`, optionally
 * time-boxed) and tallies a real product count per vendor in the same pass —
 * no extra per-brand requests. Callers with a short wall-clock budget
 * (Website Restructure's sources route) pass `timeBudgetMs` and accept a
 * partial roster rather than timing the whole request out.
 */
export async function fetchShopifyVendorBrands(
  integration: IntegrationRecord,
  options: BrandFetchOptions = {}
): Promise<BrandTaxonomyItem[]> {
  const counts = new Map<string, number>();
  let after: string | null = null;
  let hasNextPage = true;
  let pages = 0;
  const maxPages = options.maxPages ?? 80; // safety cap: 80 * 250 = 20,000 products
  const startedAt = Date.now();
  const outOfTime = () =>
    options.timeBudgetMs !== undefined && Date.now() - startedAt >= options.timeBudgetMs;

  while (hasNextPage && pages < maxPages && !outOfTime()) {
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
    .map(([name, productCount]) => ({
      id: `brand-${slugifyBrandName(name)}`,
      name,
      handle: slugifyBrandName(name),
      productCount,
    }));
}

type WooAttribute = { id?: number; name?: string; slug?: string };
type WooAttributeTerm = { id?: number; name?: string; slug?: string; count?: number };
type WooBrandTerm = { id?: number; name?: string; slug?: string; count?: number };

/** Attribute names commonly used for the "Brand" field across WooCommerce stores. */
const BRAND_ATTRIBUTE_NAMES = ["brand", "brands", "vendor", "vendors", "manufacturer", "marque"];

function wooBrandTermToItem(term: WooBrandTerm | WooAttributeTerm): BrandTaxonomyItem | null {
  const name = (term.name ?? "").trim();
  if (!name) return null;
  const handle = (term.slug ?? "").trim() || slugifyBrandName(name);
  return {
    id: `brand-${handle}`,
    name,
    handle,
    // WooCommerce term endpoints (both the brand taxonomy and attribute
    // terms) return a real `count` of products carrying that term — this is
    // the brand's true product count, not an estimate.
    productCount: Number(term.count) || 0,
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
 * an empty list — never a thrown error — if the store has neither.
 */
export async function fetchWooBrandTaxonomy(
  integration: IntegrationRecord,
  options: BrandFetchOptions = {}
): Promise<BrandTaxonomyItem[]> {
  const client = createWooClient(integration);
  const startedAt = Date.now();
  const outOfTime = () =>
    options.timeBudgetMs !== undefined && Date.now() - startedAt >= options.timeBudgetMs;

  // 1. Dedicated brand taxonomy endpoint, if a brands plugin is active.
  try {
    const brands: BrandTaxonomyItem[] = [];
    let page = 1;
    while (!outOfTime()) {
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
      return BRAND_ATTRIBUTE_NAMES.some((candidate) => name === candidate || name.includes(candidate));
    });
    if (!brandAttr?.id) return [];

    const brands: BrandTaxonomyItem[] = [];
    let page = 1;
    while (!outOfTime()) {
      const terms = await client.get<WooAttributeTerm[]>(`/products/attributes/${brandAttr.id}/terms`, {
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
    return brands.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("[fetchWooBrandTaxonomy] Failed to fetch brand attribute terms:", error);
    return [];
  }
}
