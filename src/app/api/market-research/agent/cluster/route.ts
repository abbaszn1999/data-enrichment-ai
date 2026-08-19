import { NextRequest, NextResponse } from "next/server";
import {
  agentClusterBodySchema,
  jsonError,
  requireMrRead,
} from "@/lib/market-research/api-schema";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runStage5CollectionClustering } from "@/lib/market-research/agent/stage5-collection-clusterer";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import type { MarketResearchProduct } from "@/components/market-research/workspace-data";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentClusterBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid cluster payload", 400);
  }

  const auth = await requireMrRead(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    let storeName = "Ecommerce Store";
    let storeCollections: Array<{
      id: string;
      name: string;
      productCount: number;
      description?: string;
    }> = [];

    try {
      const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
      storeName = catalog.storeName || storeName;
      storeCollections = catalog.collections.map((c) => ({
        id: c.id,
        name: c.name,
        productCount: c.productCount,
        description: c.description || undefined,
      }));
    } catch {
      // Proceed even if catalog fetch fails
    }

    // Load rich products from Object Storage slice if projectId is available
    let products: MarketResearchProduct[] = [];
    if (parsed.data.projectId) {
      try {
        const loaded = await loadProjectSliceAdmin<MarketResearchProduct[]>(
          auth.admin,
          parsed.data.workspaceId,
          parsed.data.projectId,
          "products"
        );
        if (Array.isArray(loaded)) {
          products = loaded;
        }
      } catch (err) {
        console.error("[cluster] Error loading products slice:", err);
      }
    }

    const result = await runStage5CollectionClustering({
      storeName,
      parentNiches: parsed.data.parentNiches,
      storeCollections,
      products,
      seedRows: parsed.data.seedRows,
      keywords: parsed.data.keywords,
    });

    if (parsed.data.projectId) {
      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "collections",
        result.collections
      ).catch((err) => console.error("[cluster] Error saving collections slice:", err));
    }

    return NextResponse.json(
      {
        collections: result.collections,
        summary: result.summary,
        isAiGenerated: result.isAiGenerated,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/cluster] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to cluster collections";
    return jsonError(msg, 500);
  }
}
