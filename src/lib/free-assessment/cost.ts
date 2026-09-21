/**
 * Extraction pricing. $6 per 1,000 keyword rows ($0.006/row) — same rate as
 * the main Growth Engine. Agent stages (classification, clustering, etc.)
 * are not billed.
 *
 * Provider: amassuo/semrush-keyword-expander, `sources: ["broad"]` only
 * (~$4/1,000 provider cost — priced at $6/1k here, not $5, since the
 * server-side filtering below shrinks the billed row count enough that a
 * flat pass-through rate would erode margin too far). Server-side
 * `minVolume`/`maxDifficulty` filters are applied by Semrush before
 * billing, so narrowing the filters genuinely lowers what gets charged —
 * see `extract/start` route.
 */

export const APIFY_SEED_PROBE_USD_PER_SEED = 0.002;
export const APIFY_KEYWORD_USD_PER_ROW = 0.006;
export const COLLECTION_PUSH_USD = 5;

/**
 * Hard per-seed ceiling on extracted/billed rows, enforced both in the
 * display (Tab 3 shows "10,000+" past this) and via the actor's own
 * `limitPerSeed` input — this matches `amassuo/semrush-keyword-expander`'s
 * own schema ceiling (`maximum: 10000`), so Semrush never returns, and we
 * never pay for, more than this many rows for a single seed.
 */
export const EXTRACT_CAP_PER_SEED = 10_000;

/**
 * Hard ceiling on how many raw keywords a Tab 3 selection may commit to
 * extracting. Each seed counts as `min(raw keywords, EXTRACT_CAP_PER_SEED)`
 * — a term shown as "10,000+" counts as 10,000 — so ten maxed-out seeds
 * fill the ceiling exactly.
 */
export const RAW_KEYWORD_SELECTION_CAP = 100_000;

/** Wallet amounts use 4 decimal places so $0.002/seed and $0.006/row survive rounding. */
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
