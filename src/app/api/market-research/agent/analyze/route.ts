import { NextRequest, NextResponse } from "next/server";
import {
  agentAnalyzeBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runStage1NicheDiscovery } from "@/lib/market-research/agent/stage1-niche-discovery";
import { saveProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import { markSliceSavedAdmin } from "@/lib/market-research/server-persist";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentAnalyzeBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid analyze payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
    const discovery = await runStage1NicheDiscovery({
      storeName: catalog.storeName,
      collections: catalog.collections,
      storeBrands: catalog.storeBrands,
    });

    if (parsed.data.projectId) {
      const projectId = parsed.data.projectId;
      const workspaceId = parsed.data.workspaceId;
      await Promise.all([
        saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "catalog", {
          storeName: catalog.storeName,
          provider: catalog.provider,
          baseUrl: catalog.baseUrl,
          collections: catalog.collections,
          storeBrands: catalog.storeBrands,
        }).catch((err) => console.error("[analyze] Error saving catalog slice:", err)),
        saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "niches", {
          niches: discovery.niches,
          structuredNiches: discovery.structuredNiches,
          excludedItems: discovery.excludedItems ?? [],
        }).catch((err) => console.error("[analyze] Error saving niches slice:", err)),
      ]);

      // Written directly here, outside the client autosave path — record the
      // fingerprint now so the next autosave doesn't compare a fresh niches
      // slice against a stale hash and re-upload an older in-memory copy
      // over it.
      await markSliceSavedAdmin(auth.admin, projectId, "niches", {
        niches: discovery.niches,
        structuredNiches: discovery.structuredNiches,
        excludedItems: discovery.excludedItems ?? [],
      });
    }

    return NextResponse.json(
      {
        storeName: catalog.storeName,
        provider: catalog.provider,
        baseUrl: catalog.baseUrl,
        isMock: catalog.isMock,
        niches: discovery.niches,
        structuredNiches: discovery.structuredNiches,
        excludedItems: discovery.excludedItems ?? [],
        agentConclusion: discovery.agentConclusion,
        beats: discovery.beats,
        isAiGenerated: discovery.isAiGenerated,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/analyze] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to analyze store";
    const status = msg.includes("No active store integration") ? 400 : 500;
    return jsonError(msg, status);
  }
}
