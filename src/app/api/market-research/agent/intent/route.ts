import { NextRequest, NextResponse } from "next/server";
import {
  agentIntentBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { runStage4IntentClassification } from "@/lib/market-research/agent/stage4-intent-classifier";
import {
  loadExtractRowsAdmin,
  appendClassifiedShardAdmin,
  loadClassifiedManifestAdmin,
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
  type ClassifiedShardItem,
} from "@/lib/market-research/storage-admin";
import type { ExtractedKeyword } from "@/components/market-research/workspace-data";
import { applyKeywordClassifications } from "@/lib/market-research/map-keywords";

export const maxDuration = 60;

// One page of the full extract archive per call. Each page runs through
// Stage 4 at its own internal batch size (100 keywords/batch, concurrency
// 5), so 500 keywords/page is ~5 batches — one wave, fast — while still
// bounding how much a single HTTP call and route invocation has to do when
// the archive holds tens of thousands of rows.
const PAGE_SIZE = 500;

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
    // Source of truth is the full chunk archive, not a stale Extract-tab
    // cache — otherwise classification (and everything downstream
    // in Stage 5) silently stops at whatever keywords.json happened to keep.
    const archive = await loadExtractRowsAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId
    );
    const total = archive.length;
    const offset = Math.min(parsed.data.offset, total);
    const batchRows = archive.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + batchRows.length;
    const done = nextOffset >= total;

    let isAiGenerated = false;
    let classifications: ClassifiedShardItem[] = [];

    if (batchRows.length > 0) {
      const byPhrase = new Map(
        batchRows.map((r) => [r.phrase.trim().toLowerCase(), r])
      );

      const result = await runStage4IntentClassification({
        keywords: batchRows.map((r) => ({ id: r.phrase, keyword: r.phrase })),
      });
      isAiGenerated = result.isAiGenerated;

      const items: ClassifiedShardItem[] = result.classified.map((c) => ({
        id: c.id,
        keyword: c.keyword,
        seedId: byPhrase.get(c.keyword.trim().toLowerCase())?.seedId ?? "",
        sheet: c.sheet,
        reason: c.reason,
        plpConcept: c.plpConcept,
      }));
      classifications = items;

      await appendClassifiedShardAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        items,
        { done }
      );

      // Overlay the same verdicts onto the UI's capped display sample by
      // keyword text, so Tab 4's table keeps showing sheet/reason for
      // whatever it already has — archive rows and UI sample rows don't
      // share an id space, so text is the only stable join key here.
      const stored = await loadProjectSliceAdmin<ExtractedKeyword[]>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "keywords"
      ).catch(() => null);

      if (Array.isArray(stored) && stored.length > 0) {
        const updated = applyKeywordClassifications(stored, items);
        await saveProjectSliceAdmin(
          auth.admin,
          parsed.data.workspaceId,
          parsed.data.projectId,
          "keywords",
          updated
        ).catch((err) => console.error("[intent] Error saving keywords slice:", err));
      }
    }

    const manifest = await loadClassifiedManifestAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId
    );

    return NextResponse.json(
      {
        offset,
        nextOffset,
        done,
        processed: batchRows.length,
        total,
        categoryCount: manifest?.categoryCount ?? 0,
        informationalCount: manifest?.informationalCount ?? 0,
        excludedCount: manifest?.excludedCount ?? 0,
        isAiGenerated,
        classifications,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/agent/intent] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to classify keywords";
    return jsonError(msg, 500);
  }
}
