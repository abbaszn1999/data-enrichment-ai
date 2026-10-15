import type { ServiceConfig } from "./config";

export interface RunTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** 10 credits = $1, rounded up to 0.001 credit, the same rule as the platform. */
export function costToCredits(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const milli = Math.round(usd * 10 * 1000 * 1e6) / 1e6;
  return Math.ceil(milli) / 1000;
}

/**
 * Cost from token counts and configured rates (billed cost wins when known).
 * `inputTokens` already contains the cache reads and writes, as Cursor's usage export shows.
 */
export function estimateUsd(usage: RunTokenUsage, rates: ServiceConfig["rates"]): number {
  const cacheRead = Math.min(Math.max(0, usage.cacheReadTokens), Math.max(0, usage.inputTokens));
  const cacheWrite = Math.min(Math.max(0, usage.cacheWriteTokens), Math.max(0, usage.inputTokens - cacheRead));
  const freshInput = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  return (
    (freshInput * rates.input +
      usage.outputTokens * rates.output +
      cacheRead * rates.cacheRead +
      cacheWrite * rates.cacheWrite) /
    1_000_000
  );
}

export interface UsageResult {
  credits: number;
  usd: number;
  source: "billed" | "estimated" | "none";
}

/** Cents Cursor reported for a run: what it charged, or the raw model cost when the plan covered it (charged is 0 then). */
export function billedCents(cost: { chargedCents: number; rawCostCents: number } | undefined): number | undefined {
  if (!cost) return undefined;
  return cost.chargedCents > 0 ? cost.chargedCents : cost.rawCostCents;
}

export function usageToCredits(params: {
  billedCents?: number;
  usage?: RunTokenUsage;
  rates: ServiceConfig["rates"];
}): UsageResult {
  if (typeof params.billedCents === "number" && params.billedCents > 0) {
    const usd = params.billedCents / 100;
    return { credits: costToCredits(usd), usd, source: "billed" };
  }
  if (params.usage) {
    const usd = estimateUsd(params.usage, params.rates);
    return { credits: costToCredits(usd), usd, source: usd > 0 ? "estimated" : "none" };
  }
  return { credits: 0, usd: 0, source: "none" };
}
