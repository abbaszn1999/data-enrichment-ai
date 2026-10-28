import type { SupabaseClient } from "@supabase/supabase-js";
import { loadShopifyConnection, shopifyGraphql } from "./shopify/client";
import { storePlatform } from "./store-connection";
import { loadWooConnection } from "./woocommerce/client";
import { searchWooStore, wooStoreInsights } from "./woocommerce/insights";

/**
 * A quick look at the store for the new-chat screen: concrete gaps with
 * counts, each with a ready prompt. No AI, a few cheap GraphQL reads, cached.
 */

export type Insight = { id: string; count: number; total: number; title: string; prompt: string };
export type StoreInsights = { scanned: number; totalProducts: number; insights: Insight[] };

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: StoreInsights }>();

type ProductNode = {
  status: string;
  totalInventory: number | null;
  tracksInventory: boolean;
  featuredMedia: { id: string } | null;
  seo: { title: string | null; description: string | null };
  description: string;
};

export type Mention = { id: string; type: "Product" | "Collection" | "Category"; title: string; image: string | null; detail: string };

/** Products and collections whose title matches, for @-mentions in the composer. */
export async function searchStore(db: SupabaseClient, workspaceId: string, term: string): Promise<Mention[]> {
  const clean = term.replace(/["\\:()*]/g, " ").trim().slice(0, 60);
  if (!clean) return [];
  if ((await storePlatform(db, workspaceId)) === "woocommerce") return searchWooStore(await loadWooConnection(db, workspaceId), clean);
  const conn = await loadShopifyConnection(db, workspaceId);
  const query = clean
    .split(/\s+/)
    .map((w) => `title:*${w}*`)
    .join(" AND ");
  const res = await shopifyGraphql(
    conn,
    `query($q: String!, $c: String!) {
      products(first: 7, query: $q, sortKey: RELEVANCE) { nodes { id title status featuredMedia { preview { image { url(transform: { maxWidth: 80 }) } } } } }
      collections(first: 4, query: $c) { nodes { id title productsCount { count } image { url(transform: { maxWidth: 80 }) } } }
    }`,
    // Collection search takes prefixes, not leading wildcards.
    { q: query, c: clean.split(/\s+/).map((w) => `title:${w}*`).join(" AND ") }
  );
  const data = res.data as {
    products?: { nodes: Array<{ id: string; title: string; status: string; featuredMedia: { preview?: { image?: { url: string } } } | null }> };
    collections?: { nodes: Array<{ id: string; title: string; productsCount: { count: number } | null; image: { url: string } | null }> };
  } | null;
  return [
    ...(data?.products?.nodes ?? []).map((p) => ({
      id: p.id,
      type: "Product" as const,
      title: p.title,
      image: p.featuredMedia?.preview?.image?.url ?? null,
      detail: p.status.toLowerCase(),
    })),
    ...(data?.collections?.nodes ?? []).map((c) => ({
      id: c.id,
      type: "Collection" as const,
      title: c.title,
      image: c.image?.url ?? null,
      detail: `${c.productsCount?.count ?? 0} products`,
    })),
  ];
}

export async function storeInsights(db: SupabaseClient, workspaceId: string): Promise<StoreInsights> {
  const cached = cache.get(workspaceId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  if ((await storePlatform(db, workspaceId)) === "woocommerce") {
    const value = await wooStoreInsights(await loadWooConnection(db, workspaceId));
    cache.set(workspaceId, { at: Date.now(), value });
    return value;
  }

  const conn = await loadShopifyConnection(db, workspaceId);
  const res = await shopifyGraphql(
    conn,
    `{
      productsCount(limit: null) { count }
      products(first: 250, sortKey: UPDATED_AT, reverse: true) {
        nodes { status totalInventory tracksInventory featuredMedia { id } seo { title description } description(truncateAt: 120) }
      }
      collections(first: 250) { nodes { productsCount { count } } }
    }`
  );
  const data = res.data as {
    productsCount?: { count: number };
    products?: { nodes: ProductNode[] };
    collections?: { nodes: Array<{ productsCount: { count: number } | null }> };
  } | null;
  const products = data?.products?.nodes ?? [];
  const total = data?.productsCount?.count ?? products.length;
  const scanned = products.length;
  const scope = scanned < total ? ` (in the ${scanned} most recently updated)` : "";

  const noImage = products.filter((p) => !p.featuredMedia).length;
  const drafts = products.filter((p) => p.status === "DRAFT").length;
  const noSeo = products.filter((p) => !p.seo?.title?.trim() || !p.seo?.description?.trim()).length;
  const thin = products.filter((p) => (p.description ?? "").replace(/\s+/g, " ").trim().length < 80).length;
  const outOfStock = products.filter((p) => p.status === "ACTIVE" && p.tracksInventory && (p.totalInventory ?? 0) <= 0).length;
  const emptyCollections = (data?.collections?.nodes ?? []).filter((c) => (c.productsCount?.count ?? 0) === 0).length;

  const insights: Insight[] = [
    {
      id: "no-image",
      count: noImage,
      total: scanned,
      title: `${noImage} products have no image${scope}`,
      prompt: "Find every product without a featured image, show them in a gallery, then find a real photo for each one and add it after I approve.",
    },
    {
      id: "no-seo",
      count: noSeo,
      total: scanned,
      title: `${noSeo} products are missing SEO title or description${scope}`,
      prompt: "Write SEO titles and meta descriptions for every product that is missing them, show me all the changes in one table, and apply them after I approve.",
    },
    {
      id: "thin-description",
      count: thin,
      total: scanned,
      title: `${thin} products have a very short description${scope}`,
      prompt: "Rewrite the descriptions that are very short so they are clear and convincing, using only facts already in each product. Show me before and after, then apply after I approve.",
    },
    {
      id: "drafts",
      count: drafts,
      total: scanned,
      title: `${drafts} draft products${scope}`,
      prompt: "List my draft products, tell me which look ready to sell and what is missing on the others, then help me publish the ready ones.",
    },
    {
      id: "out-of-stock",
      count: outOfStock,
      total: scanned,
      title: `${outOfStock} active products are out of stock${scope}`,
      prompt: "Show me the active products that are out of stock, by location, and suggest what to restock first.",
    },
    {
      id: "empty-collections",
      count: emptyCollections,
      total: data?.collections?.nodes.length ?? 0,
      title: `${emptyCollections} collections are empty`,
      prompt: "Review my empty collections: why are they empty, and propose which products belong in each or which to remove.",
    },
  ]
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count);

  const value = { scanned, totalProducts: total, insights };
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}
