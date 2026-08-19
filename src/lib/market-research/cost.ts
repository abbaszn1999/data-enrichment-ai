/** Actual Apify cost, no markup. Agent stages are not billed. */

export const APIFY_SEED_PROBE_USD_PER_SEED = 0.002;
export const APIFY_KEYWORD_USD_PER_ROW = 0.01;
export const COLLECTION_PUSH_USD = 5;

export const KEYWORDS_PER_PAGE = 100;
export const MAX_EXTRACT_PAGES = 100;
export const EXTRACT_CAP_PER_SEED = KEYWORDS_PER_PAGE * MAX_EXTRACT_PAGES;

/** Wallet amounts use 4 decimal places so $0.002/seed and $0.01/row survive rounding. */
export function roundUsd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 10_000) / 10_000;
}

export function estimateProbeCostUsd(seedCount: number): number {
  return roundUsd(Math.max(0, seedCount) * APIFY_SEED_PROBE_USD_PER_SEED);
}

/** Estimate billed rows for one seed: min(ideas, 10_000). */
export function cappedKeywordEstimate(rawKeywordEstimate: number): number {
  if (!Number.isFinite(rawKeywordEstimate) || rawKeywordEstimate <= 0) return 0;
  return Math.min(EXTRACT_CAP_PER_SEED, Math.floor(rawKeywordEstimate));
}

export function pagesForEstimate(rawKeywordEstimate: number): number {
  const capped = cappedKeywordEstimate(rawKeywordEstimate);
  if (capped <= 0) return 1;
  return Math.min(MAX_EXTRACT_PAGES, Math.max(1, Math.ceil(capped / KEYWORDS_PER_PAGE)));
}

export function estimateExtractCostUsd(rawKeywordEstimate: number): number {
  return roundUsd(cappedKeywordEstimate(rawKeywordEstimate) * APIFY_KEYWORD_USD_PER_ROW);
}

export function actualExtractCostUsd(rowsReturned: number): number {
  return roundUsd(Math.max(0, Math.floor(rowsReturned)) * APIFY_KEYWORD_USD_PER_ROW);
}

export function actualProbeCostUsd(seedsReturned: number): number {
  return estimateProbeCostUsd(seedsReturned);
}

export function collectionPushCostUsd(collectionCount: number): number {
  return roundUsd(Math.max(0, Math.floor(collectionCount)) * COLLECTION_PUSH_USD);
}

export function formatUsd(amount: number): string {
  const abs = Math.abs(amount);
  if (abs > 0 && abs < 0.01) {
    return `$${amount.toLocaleString("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 4,
    })}`;
  }
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
