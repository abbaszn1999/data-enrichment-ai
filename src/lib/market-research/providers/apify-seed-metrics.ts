import {
  actorSeedMetricsId,
  getActorRun,
  isTerminalRunStatus,
  listDatasetItems,
  mapRunStatus,
  startActorRun,
} from "./apify-client";
import { normalizeSeedTerm } from "./keyword-provider";
import type { SeedMetrics } from "./keyword-provider";
import { parseSeedMetricsItem } from "./parse-seed-metrics";

const PROBE_BUDGET_MS = 50_000;
const POLL_MS = 2_000;
const MAX_SEEDS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchApifySeedMetrics(
  seeds: string[],
  database: string
): Promise<SeedMetrics[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of seeds) {
    const seed = normalizeSeedTerm(raw);
    if (!seed) continue;
    const key = seed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(seed);
    if (unique.length >= MAX_SEEDS) break;
  }
  if (unique.length === 0) return [];

  const run = await startActorRun(actorSeedMetricsId(), {
    mode: "keyword",
    keywords: unique,
    database,
    concurrency: Math.min(10, Math.max(3, unique.length)),
  });

  const deadline = Date.now() + PROBE_BUDGET_MS;
  let status = run.status;
  let datasetId = run.defaultDatasetId;
  while (!isTerminalRunStatus(status) && Date.now() < deadline) {
    await sleep(POLL_MS);
    const latest = await getActorRun(run.id);
    status = latest.status;
    datasetId = latest.defaultDatasetId || datasetId;
  }

  const mapped = mapRunStatus(status);
  if (mapped !== "succeeded") {
    throw new Error(
      mapped === "running"
        ? "Seed metrics actor timed out"
        : `Seed metrics actor ${mapped}`
    );
  }
  if (!datasetId) return [];

  const items: unknown[] = [];
  let offset = 0;
  for (;;) {
    const page = await listDatasetItems<unknown>(datasetId, offset, 100);
    items.push(...page);
    if (page.length < 100) break;
    offset += page.length;
    if (items.length >= MAX_SEEDS * 2) break;
  }

  const bySeed = new Map<string, SeedMetrics>();
  for (const item of items) {
    const parsed = parseSeedMetricsItem(item, "", database);
    if (!parsed) continue;
    bySeed.set(parsed.seed.toLowerCase(), parsed);
  }

  return unique.map((seed) => {
    const existing = bySeed.get(seed.toLowerCase());
    if (existing) return { ...existing, seed };
    return {
      seed,
      database,
      volume: 0,
      cpcUsd: 0,
      keywordDifficulty: 0,
      competition: 0,
      intents: [],
      trend12m: [],
      keywordIdeasTotal: 0,
      keywordIdeasTotalVolume: 0,
      relatedKeywords: [],
      questions: [],
    };
  });
}
