import {
  actorKeywordExpanderId,
  abortActorRun,
  assertRunBelongsToActor,
  getActorRun,
  listDatasetItems,
  mapRunStatus,
  startActorRun,
} from "./apify-client";
import type {
  KeywordExtractFilters,
  KeywordIdeasHandle,
  KeywordIdeasPoll,
  KeywordRow,
} from "./keyword-provider";
import { normalizeSeedTerm } from "./keyword-provider";

const PAGE_SIZE = 250;

/**
 * `amassuo/semrush-keyword-expander` — replaces the old phrase-match
 * `pnda/semrush-keyword` actor. We request `sources: ["broad"]` only (the
 * cheapest report, and the same match type the demand-check probe's raw
 * count already represents), plus `minVolume`/`maxDifficulty`, which
 * Semrush applies server-side *before* billing.
 */
export const KEYWORD_EXPANDER_SOURCES = ["broad"] as const;

/**
 * `clean=true`-style actors can return fewer than `limit` items while more
 * rows still exist. A short page is not EOF — only an empty page is.
 */
export function datasetPageExhausted(returnedCount: number): boolean {
  return returnedCount <= 0;
}

function num(value: unknown, fallback = 0): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseKeywordExpanderItem(
  item: unknown,
  seed: string,
  database: string
): KeywordRow | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const phrase = str(row.keyword ?? row.phrase ?? row.q);
  if (!phrase) return null;
  return {
    phrase,
    database: str(row.database) || database,
    volume: Math.max(0, Math.floor(num(row.volume))),
    cpc: num(row.cpc),
    competitionLevel: num(row.competition ?? row.competition_level),
    difficulty: Math.max(0, Math.floor(num(row.difficulty ?? row.kd))),
    results: Math.max(0, Math.floor(num(row.results))),
    // amassuo doesn't return intents/serpFeatures/trends — production
    // classification runs through the separate Gemini "Analyze with AI"
    // step, not through these fields.
    intents: [],
    serpFeatures: [],
    trends: [],
    seed,
  };
}

export async function startApifyKeywordExpander(
  seed: string,
  database: string,
  filters: KeywordExtractFilters
): Promise<KeywordIdeasHandle> {
  const term = normalizeSeedTerm(seed);
  const safeLimit = Math.min(20_000, Math.max(1, Math.floor(filters.limitPerSeed) || 1));
  const input: Record<string, unknown> = {
    seedKeywords: [term],
    sources: KEYWORD_EXPANDER_SOURCES,
    database,
    limitPerSeed: safeLimit,
  };
  if (typeof filters.minVolume === "number" && filters.minVolume > 0) {
    input.minVolume = Math.floor(filters.minVolume);
  }
  if (typeof filters.maxDifficulty === "number" && filters.maxDifficulty < 100) {
    input.maxDifficulty = Math.max(0, Math.floor(filters.maxDifficulty));
  }
  const run = await startActorRun(actorKeywordExpanderId(), input);
  return {
    runId: run.id,
    datasetId: run.defaultDatasetId,
    seed: term,
    database,
    limitPerSeed: safeLimit,
  };
}

export async function pollApifyKeywordExpander(
  handle: KeywordIdeasHandle,
  cursor?: string
): Promise<KeywordIdeasPoll> {
  const run = await getActorRun(handle.runId);
  await assertRunBelongsToActor(run, actorKeywordExpanderId());
  const status = mapRunStatus(run.status);
  const datasetId = run.defaultDatasetId || handle.datasetId;
  const offset = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);

  if (status === "failed") {
    return {
      status,
      rows: [],
      datasetId,
      error: run.statusMessage || "Keyword expander actor failed",
    };
  }
  if (status === "aborted") {
    return { status, rows: [], datasetId, error: "Keyword expander actor aborted" };
  }
  if (!datasetId) {
    return {
      status: status === "succeeded" ? "succeeded" : "running",
      rows: [],
      datasetId,
    };
  }

  const items = await listDatasetItems<unknown>(datasetId, offset, PAGE_SIZE);
  const rows = items
    .map((item) => parseKeywordExpanderItem(item, handle.seed, handle.database))
    .filter((row): row is KeywordRow => Boolean(row));
  const nextOffset = offset + items.length;
  const exhausted = datasetPageExhausted(items.length);

  if (status === "succeeded") {
    return {
      status: "succeeded",
      rows,
      datasetId,
      nextCursor: exhausted ? undefined : String(nextOffset),
    };
  }

  return {
    status: "running",
    rows,
    datasetId,
    nextCursor: items.length > 0 ? String(nextOffset) : cursor,
  };
}

export async function abortApifyKeywordExpander(runId: string): Promise<void> {
  if (!runId || runId.startsWith("mock:")) return;
  const run = await getActorRun(runId);
  await assertRunBelongsToActor(run, actorKeywordExpanderId());
  await abortActorRun(runId);
}
