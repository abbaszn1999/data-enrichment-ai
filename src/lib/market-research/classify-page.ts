import type { SupabaseClient } from "@supabase/supabase-js";
import { runStage4IntentClassification } from "@/lib/market-research/agent/stage4-intent-classifier";
import { runSameIntentInMemory } from "@/lib/market-research/agent/same-intent-job";
import {
  appendClassifiedShardAdmin,
  clearClassifiedShardsAdmin,
  clearSameIntentAdmin,
  loadClassifiedItemsAdmin,
  loadExtractRowsAdmin,
  loadProjectSliceAdmin,
  type ClassifiedShardItem,
} from "@/lib/market-research/storage-admin";
import type { ExtractedKeyword } from "@/components/market-research/workspace-data";
import { MAX_DISPLAY_ROWS, toExtractedKeyword } from "@/lib/market-research/map-keywords";
import { overlayAndPersistKeywordClassifications } from "@/lib/market-research/extract-advance";

const PAGE_SIZE = 500;

/** Saved in `job_runs.settings.checkpoint` after every page so a restart resumes. */
export type ClassifyCheckpoint = {
  phase: "classify" | "same-intent";
  classifyOffset: number;
};

export type ClassifyProgress = {
  phase: "classify" | "same-intent";
  done: number;
  total: number;
  checkpoint: ClassifyCheckpoint;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Verdicts saved by an earlier run of this job. Fails rather than resuming on a short read. */
async function loadClassifiedAtLeast(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  expected: number
): Promise<ClassifiedShardItem[]> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const items = await loadClassifiedItemsAdmin(admin, workspaceId, projectId);
    if (items.length >= expected) return items;
    await sleep(1500 * attempt);
  }
  throw new Error(
    `Only part of the saved classification could be read back (expected ${expected}). Run Analyze again.`
  );
}

export async function runMrClassifyThenClean(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  opts: {
    resume?: ClassifyCheckpoint | null;
    onProgress?: (progress: ClassifyProgress) => Promise<void>;
  } = {}
): Promise<void> {
  const archive = await loadExtractRowsAdmin(admin, workspaceId, projectId);
  const total = archive.length;
  let offset = Math.min(Math.max(0, opts.resume?.classifyOffset ?? 0), total);

  let classified: ClassifiedShardItem[] = [];
  if (offset === 0) {
    await clearClassifiedShardsAdmin(admin, workspaceId, projectId).catch((err) =>
      console.error("[classify] Failed to clear classified shards:", err)
    );
    await clearSameIntentAdmin(admin, workspaceId, projectId).catch((err) =>
      console.error("[classify] Failed to clear same-intent manifest:", err)
    );
  } else {
    classified = await loadClassifiedAtLeast(admin, workspaceId, projectId, offset);
  }

  let sample = await loadProjectSliceAdmin<ExtractedKeyword[]>(
    admin,
    workspaceId,
    projectId,
    "keywords"
  ).catch(() => null);
  if (!Array.isArray(sample) || sample.length === 0) {
    sample = archive
      .slice(0, MAX_DISPLAY_ROWS)
      .map((row, index) => toExtractedKeyword(row, row.seedId || row.seed || "seed", index));
  }

  while (offset < total) {
    const batchRows = archive.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + batchRows.length;
    const byPhrase = new Map(batchRows.map((row) => [row.phrase.trim().toLowerCase(), row]));
    const result = await runStage4IntentClassification({
      keywords: batchRows.map((row) => ({ id: row.phrase, keyword: row.phrase })),
    });
    const items: ClassifiedShardItem[] = result.classified.map((item) => ({
      id: item.id,
      keyword: item.keyword,
      seedId: byPhrase.get(item.keyword.trim().toLowerCase())?.seedId ?? "",
      sheet: item.sheet,
      reason: item.reason,
      plpConcept: item.plpConcept,
      isAiGenerated: item.isAiGenerated,
    }));
    await appendClassifiedShardAdmin(admin, workspaceId, projectId, items, {
      done: nextOffset >= total,
    });
    classified = [...classified, ...items];
    offset = nextOffset;
    sample = await overlayAndPersistKeywordClassifications(
      admin,
      workspaceId,
      projectId,
      sample,
      { classified, drops: [] }
    );
    await opts.onProgress?.({
      phase: "classify",
      done: offset,
      total,
      checkpoint: {
        phase: offset >= total ? "same-intent" : "classify",
        classifyOffset: offset,
      },
    });
  }

  const drops = await runSameIntentInMemory(
    admin,
    workspaceId,
    projectId,
    classified,
    async (progress) => {
      await opts.onProgress?.({
        phase: "same-intent",
        done: progress.done,
        total: progress.total,
        checkpoint: { phase: "same-intent", classifyOffset: offset },
      });
    }
  );
  await overlayAndPersistKeywordClassifications(admin, workspaceId, projectId, sample, {
    classified,
    drops,
  });
}
