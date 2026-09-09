import { NextRequest, NextResponse } from "next/server";
import {
  productsFetchBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  fetchStoreProductsPage,
  initProductFetchCursor,
} from "@/lib/market-research/agent/store-catalog";
import { appendProductsShardAdmin } from "@/lib/market-research/storage-admin";

// Real store catalogs can hold tens of thousands of products across the
// selected collections — far past a single Shopify/WooCommerce page (250 /
// 100 items). This route pages as far as it can inside ~40s, persists what
// it fetched as a new shard, and returns a resumable cursor. The client
// calls this in a loop (same pattern as the Apify extract poll) until
// `done` is true.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = productsFetchBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid products fetch payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const cursor = parsed.data.cursor ?? initProductFetchCursor();

    const { products, cursor: nextCursor } = await fetchStoreProductsPage(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.selectedCollections.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        productCount: c.productCount,
        parentNicheName: c.parentNicheName,
      })),
      cursor
    );

    const manifest = await appendProductsShardAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      products,
      { done: nextCursor.done }
    );

    return NextResponse.json(
      {
        cursor: nextCursor,
        fetchedThisCall: products.length,
        totalFetched: manifest.totalCount,
        done: nextCursor.done,
        productCountByCollectionId: manifest.productCountByCollectionId,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/products/fetch] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to fetch products";
    return jsonError(msg, 500);
  }
}
