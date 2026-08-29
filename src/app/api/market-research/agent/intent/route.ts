import { NextRequest, NextResponse } from "next/server";
import {
  agentIntentBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import { runStage4IntentClassification } from "@/lib/market-research/agent/stage4-intent-classifier";
import { saveProjectSliceAdmin } from "@/lib/market-research/storage-admin";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = agentIntentBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid intent payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    let storeName = "Ecommerce Store";
    try {
      const catalog = await fetchStoreCatalog(auth.admin, parsed.data.workspaceId);
      storeName = catalog.storeName || storeName;
    } catch {
      // Allow intent classification even if store catalog fetch fails
    }

    const result = await runStage4IntentClassification({
      storeName,
      parentNiches: parsed.data.parentNiches,
      collections: parsed.data.collections,
      keywords: parsed.data.keywords,
    });

    if (parsed.data.projectId) {
      // Map classified result back to full keyword format if possible
      const byId = new Map(result.classified.map((c) => [c.id, c]));
      const fullKeywords = parsed.data.keywords.map((kw) => {
        const item = byId.get(kw.id);
        return {
          id: kw.id,
          seedId: kw.seed || "",
          seed: kw.seed || "",
          keyword: kw.keyword,
          volume: kw.volume ?? 0,
          difficulty: kw.difficulty ?? 0,
          wordCount: kw.keyword.trim().split(/\s+/).length,
          isQuestion: item?.sheet === "informational",
          sheet: item?.sheet ?? "category",
          exclusionReason: item?.reason,
          plpConcept: item?.plpConcept,
          productMatches: 0,
          weight: 1,
        };
      });

      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "keywords",
        fullKeywords
      ).catch((err) => console.error("[intent] Error saving keywords slice:", err));
    }

    return NextResponse.json(
      {
        classified: result.classified,
        summary: result.summary,
        isAiGenerated: result.isAiGenerated,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/intent] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to classify keywords";
    return jsonError(msg, 500);
  }
}
