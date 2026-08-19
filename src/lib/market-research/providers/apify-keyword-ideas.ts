import {
  actorKeywordIdeasId,
  abortActorRun,
  assertRunBelongsToActor,
  getActorRun,
  listDatasetItems,
  mapRunStatus,
  startActorRun,
} from "./apify-client";
import type {
  KeywordIdeasHandle,
  KeywordIdeasPoll,
  KeywordRow,
} from "./keyword-provider";
import { normalizeSeedTerm } from "./keyword-provider";
import { decodeIntents, decodeSerpFeatures } from "./semrush-codes";

const PAGE_SIZE = 250;

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

export function parseKeywordIdeaItem(
  item: unknown,
  seed: string,
  database: string
): KeywordRow | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const phrase = str(row.phrase ?? row.keyword ?? row.q);
  if (!phrase) return null;
  const trends = Array.isArray(row.trends)
    ? row.trends.map((value) => num(value)).slice(0, 12)
    : [];
  return {
    phrase,
    database: str(row.database) || database,
    volume: Math.max(0, Math.floor(num(row.volume))),
    cpc: num(row.cpc),
    competitionLevel: num(row.competition_level ?? row.competition),
    difficulty: Math.max(0, Math.floor(num(row.difficulty ?? row.kd))),
    results: Math.max(0, Math.floor(num(row.results))),
    intents: decodeIntents(row.intents),
    serpFeatures: decodeSerpFeatures(row.serp_features),
    trends,
    seed,
  };
}

export async function startApifyKeywordIdeas(
  seed: string,
  database: string,
  pages: number
): Promise<KeywordIdeasHandle> {
  const term = normalizeSeedTerm(seed);
  const safePages = Math.min(100, Math.max(1, Math.floor(pages) || 1));
  const run = await startActorRun(actorKeywordIdeasId(), {
    q: term,
    db: database,
    type: "phrase",
    pages: safePages,
  });
  return {
    runId: run.id,
    datasetId: run.defaultDatasetId,
    seed: term,
    database,
    pages: safePages,
  };
}

export async function pollApifyKeywordIdeas(
  handle: KeywordIdeasHandle,
  cursor?: string
): Promise<KeywordIdeasPoll> {
  const run = await getActorRun(handle.runId);
  await assertRunBelongsToActor(run, actorKeywordIdeasId());
  const status = mapRunStatus(run.status);
  const datasetId = run.defaultDatasetId || handle.datasetId;
  const offset = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);

  if (status === "failed") {
    return {
      status,
      rows: [],
      datasetId,
      error: run.statusMessage || "Keyword ideas actor failed",
    };
  }
  if (status === "aborted") {
    return { status, rows: [], datasetId, error: "Keyword ideas actor aborted" };
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
    .map((item) => parseKeywordIdeaItem(item, handle.seed, handle.database))
    .filter((row): row is KeywordRow => Boolean(row));
  const nextOffset = offset + items.length;
  const exhausted = items.length < PAGE_SIZE;

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

export async function abortApifyKeywordIdeas(runId: string): Promise<void> {
  if (!runId || runId.startsWith("mock:")) return;
  const run = await getActorRun(runId);
  await assertRunBelongsToActor(run, actorKeywordIdeasId());
  await abortActorRun(runId);
}
