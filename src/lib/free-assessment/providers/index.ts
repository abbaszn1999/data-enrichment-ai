import { createMockKeywordProvider } from "./mock-provider";
import { fetchApifySeedMetrics } from "./apify-seed-metrics";
import {
  abortApifyKeywordExpander,
  pollApifyKeywordExpander,
  startApifyKeywordExpander,
} from "./apify-keyword-expander";
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
    startKeywordIdeas: startApifyKeywordExpander,
    pollKeywordIdeas: pollApifyKeywordExpander,
    abortKeywordIdeas: abortApifyKeywordExpander,
  };
}

export type { KeywordDataProvider } from "./keyword-provider";
