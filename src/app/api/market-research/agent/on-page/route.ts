import { NextRequest, NextResponse } from "next/server";
import {
  agentOnPageBodySchema,
  jsonError,
  requireMrRead,
} from "@/lib/market-research/api-schema";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runStage6OnPageGeneration } from "@/lib/market-research/agent/stage6-on-page-generator";
import { saveProjectSliceAdmin } from "@/lib/market-research/storage-admin";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentOnPageBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid on-page payload", 400);
  }

  const auth = await requireMrRead(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    let storeName = "Ecommerce Store";
    let storeCollections: any[] = [];
    try {
      const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
      storeName = catalog.storeName || storeName;
      storeCollections = catalog.collections || [];
    } catch {
      // Proceed even if catalog fetch fails
    }

    const result = await runStage6OnPageGeneration({
      storeName,
      parentNiches: parsed.data.parentNiches,
      collections: parsed.data.collections,
      allStoreCollections: storeCollections,
      customInstructions: parsed.data.customInstructions,
    });

    if (parsed.data.projectId) {
      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "content",
        result.contentById
      ).catch((err) => console.error("[on-page] Error saving content slice:", err));
    }

    return NextResponse.json(
      {
        contentById: result.contentById,
        isAiGenerated: result.isAiGenerated,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/on-page] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to generate on-page content";
    return jsonError(msg, 500);
  }
}
