import { NextRequest, NextResponse } from "next/server";
import {
  agentAnalyzeBodySchema,
  jsonError,
  requireFaWrite,
} from "@/lib/free-assessment/api-schema";
import { csvRowsToCollectionItems } from "@/lib/free-assessment/agent/csv-catalog";
import { runStage1NicheDiscovery } from "@/lib/free-assessment/agent/stage1-niche-discovery";
import { saveProjectSliceAdmin } from "@/lib/free-assessment/storage-admin";

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

  const auth = await requireFaWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const { collections, brands } = csvRowsToCollectionItems(parsed.data.plpRows);
    const discovery = await runStage1NicheDiscovery({
      storeName: "the uploaded catalog",
      collections,
      storeBrands: brands,
    });

    if (parsed.data.projectId) {
      const projectId = parsed.data.projectId;
      const workspaceId = parsed.data.workspaceId;
      await Promise.all([
        saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "catalog", {
          plpRows: parsed.data.plpRows,
        }).catch((err) => console.error("[fa-analyze] Error saving catalog slice:", err)),
        saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "niches", {
          niches: discovery.niches,
          structuredNiches: discovery.structuredNiches,
        }).catch((err) => console.error("[fa-analyze] Error saving niches slice:", err)),
      ]);
    }

    return NextResponse.json(
      {
        rowCount: parsed.data.plpRows.length,
        niches: discovery.niches,
        structuredNiches: discovery.structuredNiches,
        agentConclusion: discovery.agentConclusion,
        beats: discovery.beats,
        isAiGenerated: discovery.isAiGenerated,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/free-assessment/agent/analyze] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to analyze sheet";
    return jsonError(msg, 500);
  }
}
