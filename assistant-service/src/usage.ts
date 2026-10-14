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

/** Cost from token counts and configured rates (an estimate; billed cost wins when known). */
export function estimateUsd(usage: RunTokenUsage, rates: ServiceConfig["rates"]): number {
  return (
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheReadTokens * rates.cacheRead +
      usage.cacheWriteTokens * rates.cacheWrite) /
    1_000_000
  );
}

export interface UsageResult {
  credits: number;
  usd: number;
  source: "billed" | "estimated" | "none";
}

export function usageToCredits(params: {
  chargedCents?: number;
  usage?: RunTokenUsage;
  rates: ServiceConfig["rates"];
}): UsageResult {
  if (typeof params.chargedCents === "number" && params.chargedCents > 0) {
    const usd = params.chargedCents / 100;
    return { credits: costToCredits(usd), usd, source: "billed" };
  }
  if (params.usage) {
    const usd = estimateUsd(params.usage, params.rates);
    return { credits: costToCredits(usd), usd, source: usd > 0 ? "estimated" : "none" };
  }
  return { credits: 0, usd: 0, source: "none" };
}
