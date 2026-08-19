import { decodeIntents } from "./semrush-codes";
import type { RelatedKeyword, SeedMetrics } from "./keyword-provider";
import { normalizeSeedTerm } from "./keyword-provider";

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

function relatedList(value: unknown): RelatedKeyword[] {
  if (!Array.isArray(value)) return [];
  const out: RelatedKeyword[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const keyword = str(row.keyword ?? row.phrase);
    if (!keyword) continue;
    out.push({
      keyword,
      volume: num(row.volume),
      keywordDifficulty: num(row.keyword_difficulty ?? row.difficulty),
    });
  }
  return out.slice(0, 40);
}

function trend12(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => num(item, 0))
    .slice(0, 12);
}

export function parseSeedMetricsItem(
  item: unknown,
  fallbackSeed: string,
  database: string
): SeedMetrics | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const seed =
    normalizeSeedTerm(str(row.keyword ?? row.seed ?? row.q)) ||
    normalizeSeedTerm(fallbackSeed);
  if (!seed) return null;

  const nested =
    row.research && typeof row.research === "object"
      ? (row.research as Record<string, unknown>)
      : row;

  return {
    seed,
    database: str(row.database) || database,
    volume: num(row.volume ?? row.search_volume),
    cpcUsd: num(row.cpc_usd ?? row.cpc),
    keywordDifficulty: num(
      row.keyword_difficulty ?? row.difficulty ?? row.kd
    ),
    competition: num(row.competition ?? row.competition_level),
    intents: decodeIntents(row.intents ?? row.intent ?? row.decoded_intent),
    trend12m: trend12(row.trend ?? row.trends ?? row.trend_12m),
    keywordIdeasTotal: Math.max(
      0,
      Math.floor(num(row.keyword_ideas_total ?? nested.keyword_ideas_total))
    ),
    keywordIdeasTotalVolume: Math.max(
      0,
      Math.floor(
        num(row.keyword_ideas_total_volume ?? nested.keyword_ideas_total_volume)
      )
    ),
    relatedKeywords: relatedList(
      row.related_keywords ?? nested.related_keywords
    ),
    questions: relatedList(row.questions ?? nested.questions),
  };
}
