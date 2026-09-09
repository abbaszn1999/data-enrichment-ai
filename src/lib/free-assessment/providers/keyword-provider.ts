import type { SearchIntent } from "./semrush-codes";

export type { SearchIntent };

export type RelatedKeyword = {
  keyword: string;
  volume: number;
  keywordDifficulty: number;
};

export type SeedMetrics = {
  seed: string;
  database: string;
  volume: number;
  cpcUsd: number;
  keywordDifficulty: number;
  competition: number;
  intents: SearchIntent[];
  trend12m: number[];
  keywordIdeasTotal: number;
  keywordIdeasTotalVolume: number;
  relatedKeywords: RelatedKeyword[];
  questions: RelatedKeyword[];
};

export type KeywordRow = {
  phrase: string;
  database: string;
  volume: number;
  cpc: number;
  competitionLevel: number;
  difficulty: number;
  results: number;
  intents: SearchIntent[];
  serpFeatures: string[];
  trends: number[];
  seed: string;
};

export type KeywordIdeasHandle = {
  runId: string;
  datasetId?: string;
  seed: string;
  database: string;
  pages: number;
};

export type KeywordIdeasStatus = "running" | "succeeded" | "failed" | "aborted";

export type KeywordIdeasPoll = {
  status: KeywordIdeasStatus;
  rows: KeywordRow[];
  nextCursor?: string;
  datasetId?: string;
  error?: string;
};

export interface KeywordDataProvider {
  fetchSeedMetrics(seeds: string[], database: string): Promise<SeedMetrics[]>;
  startKeywordIdeas(
    seed: string,
    database: string,
    pages: number
  ): Promise<KeywordIdeasHandle>;
  pollKeywordIdeas(
    handle: KeywordIdeasHandle,
    cursor?: string
  ): Promise<KeywordIdeasPoll>;
  abortKeywordIdeas(runId: string): Promise<void>;
}

const MARKET_DB: Record<string, string> = {
  us: "us",
  gb: "uk",
  uk: "uk",
  sa: "sa",
  ae: "ae",
  de: "de",
  ca: "ca",
  au: "au",
  fr: "fr",
  it: "it",
  es: "es",
  br: "br",
  nl: "nl",
  jp: "jp",
  in: "in",
  sg: "sg",
  mx: "mx",
};

/** `us-en` / `gb-en` → Semrush database code. Unknown markets fall back to `us`. */
export function marketToSemrushDb(market: string): string {
  const country = market.trim().toLowerCase().split("-")[0] ?? "us";
  return MARKET_DB[country] ?? "us";
}

export function normalizeSeedTerm(term: string): string {
  return term.trim().replace(/\s+/g, " ");
}
