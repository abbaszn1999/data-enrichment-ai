import { NextRequest, NextResponse } from "next/server";
import {
  agentStrategyBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  fetchStoreCatalog,
  type StoreCollectionItem,
} from "@/lib/market-research/agent/store-catalog";
import { runStage7ContentPlan } from "@/lib/market-research/agent/stage7-content-planner";
import {
  loadProjectProducts,
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import type {
  ExtractedKeyword,
  MarketResearchProduct,
  ProposedCollection,
} from "@/components/market-research/workspace-data";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentStrategyBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid strategy payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    let storeName = "Ecommerce Store";
    let storeCollections: StoreCollectionItem[] = [];
    try {
      const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
      storeName = catalog.storeName || storeName;
      storeCollections = catalog.collections || [];
    } catch {
      // The plan is still useful without the catalog; it just links out to less.
    }

    const { data: workspaceRow } = await auth.admin
      .from("workspaces")
      .select("collection_prefix")
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();
    const collectionPrefix =
      (workspaceRow?.collection_prefix ?? "AI").trim() || "AI";

    // The body's `collections` only carry the fields proposedCollectionSchema
    // validates (id, name, volume, storeHandle, ...) — no `productMatches`.
    // The canonical list with the Stage 5 product matches lives in storage,
    // same as the internal-links route already relies on.
    let proposedCollections: ProposedCollection[] =
      (parsed.data.collections as ProposedCollection[] | undefined) ?? [];
    let productsById: Map<string, MarketResearchProduct> | undefined;

    if (parsed.data.projectId) {
      const [storedCollections, products] = await Promise.all([
        loadProjectSliceAdmin<ProposedCollection[]>(
          auth.admin,
          parsed.data.workspaceId,
          parsed.data.projectId,
          "collections"
        ).catch(() => null),
        loadProjectProducts(
          auth.admin,
          parsed.data.workspaceId,
          parsed.data.projectId
        ).catch(() => [] as MarketResearchProduct[]),
      ]);

      if (Array.isArray(storedCollections) && storedCollections.length > 0) {
        proposedCollections = storedCollections;
      }
      if (products.length > 0) {
        productsById = new Map(products.map((product) => [product.id, product]));
      }
    }

    const result = await runStage7ContentPlan({
      keywords: parsed.data.keywords as ExtractedKeyword[],
      storeName,
      parentNiches: parsed.data.parentNiches,
      storeCollections,
      proposedCollections,
      products: productsById,
      collectionPrefix,
    });

    if (parsed.data.projectId) {
      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "strategy",
        result.articles
      ).catch((err) =>
        console.error("[strategy] Error saving strategy slice:", err)
      );
    }

    return NextResponse.json(
      {
        articles: result.articles,
        isAiGenerated: result.isAiGenerated,
        droppedByCap: result.droppedByCap,
        mergedByIntent: result.mergedByIntent,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/strategy] Error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to build the content plan";
    return jsonError(msg, 500);
  }
}
