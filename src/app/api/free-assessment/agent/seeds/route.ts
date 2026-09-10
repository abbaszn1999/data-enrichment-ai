import { NextRequest, NextResponse } from "next/server";
import {
  agentSeedsBodySchema,
  jsonError,
  requireFaWrite,
} from "@/lib/free-assessment/api-schema";
import { runStage3SeedGeneration } from "@/lib/free-assessment/agent/stage3-seed-generator";
import { saveProjectSliceAdmin } from "@/lib/free-assessment/storage-admin";

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

  const auth = await requireFaWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const result = await runStage3SeedGeneration({
      storeName: parsed.data.storeLabel || "the uploaded catalog",
      selectedCollections: parsed.data.selectedCollections,
    });

    if (parsed.data.projectId) {
      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "seeds",
        { seedRows: result.seedRows, manualSeeds: [] }
      ).catch((err) => console.error("[fa-seeds] Error saving seeds slice:", err));
    }

    return NextResponse.json(
      { seedRows: result.seedRows, isAiGenerated: result.isAiGenerated },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/free-assessment/agent/seeds] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to generate seeds";
    return jsonError(msg, 500);
  }
}
