import { createMockKeywordProvider } from "./mock-provider";
import { fetchApifySeedMetrics } from "./apify-seed-metrics";
import {
  abortApifyKeywordIdeas,
  pollApifyKeywordIdeas,
  startApifyKeywordIdeas,
} from "./apify-keyword-ideas";
import type { KeywordDataProvider } from "./keyword-provider";

export function keywordProviderMode(): "apify" | "mock" {
  const forced = (process.env.MR_KEYWORD_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "mock") return "mock";
  if (forced === "apify") return "apify";
  return process.env.APIFY_TOKEN?.trim() ? "apify" : "mock";
}

export function getKeywordProvider(): KeywordDataProvider {
  if (keywordProviderMode() === "mock") {
    return createMockKeywordProvider();
  }
  return {
    fetchSeedMetrics: fetchApifySeedMetrics,
    startKeywordIdeas: startApifyKeywordIdeas,
    pollKeywordIdeas: pollApifyKeywordIdeas,
    abortKeywordIdeas: abortApifyKeywordIdeas,
  };
}

export type { KeywordDataProvider } from "./keyword-provider";
