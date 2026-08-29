import { NextRequest, NextResponse } from "next/server";
import {
  agentSeedsBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  fetchStoreCatalog,
  fetchStoreProductsForCollections,
} from "@/lib/market-research/agent/store-catalog";
import { runStage3SeedGeneration } from "@/lib/market-research/agent/stage3-seed-generator";
import { saveProjectSliceAdmin } from "@/lib/market-research/storage-admin";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentSeedsBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid seeds payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
    
    // Run seed generation for the selected collections
    const result = await runStage3SeedGeneration({
      storeName: catalog.storeName,
      selectedCollections: parsed.data.selectedCollections,
    });

    // Fetch full rich product details for the selected collections
    const products = await fetchStoreProductsForCollections(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.selectedCollections
    );

    if (parsed.data.projectId) {
      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "seeds",
        {
          seedRows: result.seedRows,
          manualSeeds: [],
        }
      ).catch((err) => console.error("[seeds] Error saving seeds slice:", err));

      if (products.length > 0) {
        await saveProjectSliceAdmin(
          auth.admin,
          parsed.data.workspaceId,
          parsed.data.projectId,
          "products",
          products
        ).catch((err) => console.error("[seeds] Error saving products slice:", err));
      }
    }

    return NextResponse.json(
      {
        seedRows: result.seedRows,
        isAiGenerated: result.isAiGenerated,
        products,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/seeds] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to generate seeds";
    const status = msg.includes("No active store integration") ? 400 : 500;
    return jsonError(msg, status);
  }
}
