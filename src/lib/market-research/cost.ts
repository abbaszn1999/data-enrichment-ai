/**
 * Extraction pricing. $5 per 1,000 keyword rows ($0.005/row) — discounted
 * off our underlying data-provider rate, not a 1:1 pass-through. Agent
 * stages (classification, clustering, on-page copy, etc.) are not billed.
 *
 * Provider: amassuo/semrush-keyword-expander, `sources: ["broad"]` only
 * (~$4/1,000 provider cost). Server-side `minVolume`/`maxDifficulty`
 * filters are applied by Semrush before billing, so narrowing the filters
 * genuinely lowers what gets charged — see `extract/start` route.
 */

export const APIFY_SEED_PROBE_USD_PER_SEED = 0.002;
export const APIFY_KEYWORD_USD_PER_ROW = 0.005;
export const COLLECTION_PUSH_USD = 5;

/**
 * Hard per-seed ceiling on extracted/billed rows, enforced both in the
 * display (Tab 3 shows "20,000+" past this) and via the actor's own
 * `limitPerSeed` input — Semrush never returns, and we never pay for,
 * more than this many rows for a single seed.
 */
export const EXTRACT_CAP_PER_SEED = 20_000;

/** Wallet amounts use 4 decimal places so $0.002/seed and $0.01/row survive rounding. */
export function roundUsd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 10_000) / 10_000;
}

export function estimateProbeCostUsd(seedCount: number): number {
  return roundUsd(Math.max(0, seedCount) * APIFY_SEED_PROBE_USD_PER_SEED);
}

/** Estimate billed rows for one seed: min(ideas, EXTRACT_CAP_PER_SEED). */
export function cappedKeywordEstimate(rawKeywordEstimate: number): number {
  if (!Number.isFinite(rawKeywordEstimate) || rawKeywordEstimate <= 0) return 0;
  return Math.min(EXTRACT_CAP_PER_SEED, Math.floor(rawKeywordEstimate));
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
