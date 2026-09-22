import type { SupabaseClient } from "@supabase/supabase-js";
import { runStage4IntentClassification } from "@/lib/market-research/agent/stage4-intent-classifier";
import { advanceSameIntent } from "@/lib/market-research/agent/same-intent-job";
import {
  appendClassifiedShardAdmin,
  clearClassifiedShardsAdmin,
  clearSameIntentAdmin,
  loadClassifiedManifestAdmin,
  loadExtractRowsAdmin,
  loadProjectSliceAdmin,
  type ClassifiedShardItem,
} from "@/lib/market-research/storage-admin";
import type { ExtractedKeyword } from "@/components/market-research/workspace-data";
import { MAX_DISPLAY_ROWS, toExtractedKeyword } from "@/lib/market-research/map-keywords";
import { overlayAndPersistKeywordClassifications } from "@/lib/market-research/extract-advance";

const PAGE_SIZE = 500;

export async function advanceMrClassifyPage(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  offset: number
) {
  const archive = await loadExtractRowsAdmin(admin, workspaceId, projectId);
  const total = archive.length;
  const start = Math.min(offset, total);
  const batchRows = archive.slice(start, start + PAGE_SIZE);
  const nextOffset = start + batchRows.length;
  const done = nextOffset >= total;

  if (start === 0) {
    await clearClassifiedShardsAdmin(admin, workspaceId, projectId).catch((err) =>
      console.error("[classify] Failed to clear classified shards:", err)
    );
    await clearSameIntentAdmin(admin, workspaceId, projectId).catch((err) =>
      console.error("[classify] Failed to clear same-intent manifest:", err)
    );
  }

  let degradedCount = 0;
  if (batchRows.length > 0) {
    const byPhrase = new Map(batchRows.map((row) => [row.phrase.trim().toLowerCase(), row]));
    const result = await runStage4IntentClassification({
      keywords: batchRows.map((row) => ({ id: row.phrase, keyword: row.phrase })),
    });
    degradedCount = result.degradedCount;
    const items: ClassifiedShardItem[] = result.classified.map((item) => ({
      id: item.id,
      keyword: item.keyword,
      seedId: byPhrase.get(item.keyword.trim().toLowerCase())?.seedId ?? "",
      sheet: item.sheet,
      reason: item.reason,
      plpConcept: item.plpConcept,
      isAiGenerated: item.isAiGenerated,
    }));
    await appendClassifiedShardAdmin(admin, workspaceId, projectId, items, { done });
    let stored = await loadProjectSliceAdmin<ExtractedKeyword[]>(
      admin,
      workspaceId,
      projectId,
      "keywords"
    ).catch(() => null);
    if (!Array.isArray(stored) || stored.length === 0) {
      stored = archive.slice(0, MAX_DISPLAY_ROWS).map((row, index) =>
        toExtractedKeyword(row, row.seedId || row.seed || "seed", index)
      );
    }
    await overlayAndPersistKeywordClassifications(admin, workspaceId, projectId, stored);
  }

  const manifest = await loadClassifiedManifestAdmin(admin, workspaceId, projectId);
  return {
    offset: start,
    nextOffset,
    done,
    total,
    degradedCount,
    categoryCount: manifest?.categoryCount ?? 0,
  };
}

export async function runMrClassifyThenClean(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  onProgress?: (progress: { phase: "classify" | "same-intent"; done: number; total: number }) => Promise<void>
): Promise<void> {
  let offset = 0;
  for (;;) {
    const page = await advanceMrClassifyPage(admin, workspaceId, projectId, offset);
    await onProgress?.({ phase: "classify", done: page.nextOffset, total: page.total });
    if (page.done) break;
    offset = page.nextOffset;
  }
  offset = 0;
  for (;;) {
    const page = await advanceSameIntent(admin, workspaceId, projectId, offset);
    await onProgress?.({
      phase: "same-intent",
      done: page.processed,
      total: Math.max(page.total, 1),
    });
    if (page.done) break;
    offset = page.nextOffset;
  }
}
