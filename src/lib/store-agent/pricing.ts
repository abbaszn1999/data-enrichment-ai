/**
 * Cursor's published per-token prices for the Store Agent models
 * (cursor.com/docs/models, read 2026-10-26), in USD per million tokens.
 *
 * Used to show a live cost while a run streams and to bill when Cursor does
 * not report the run's real cost. When it does, the billed figure wins.
 *
 * Customers pay the exact model cost: 10 credits = $1, no margin.
 */

export type ModelParam = { id: string; value: string };

/**
 * One image from the agent's image tool. Cursor bills it outside the token
 * counts and does not report the figure to this account, so we charge
 * Cursor's published image price (Gemini 3 Pro Image: about $0.134 per
 * 1K/2K image, cursor.com/docs/models).
 */
export const IMAGE_GENERATION_USD = 0.134;

/** One Google Images search through Serper. */
export const SERPER_USD_PER_QUERY = 0.001;

export type TokenUsage = {
  /** All prompt tokens, including cache reads and cache writes. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

type Rates = { input: number; cacheWrite: number; cacheRead: number; output: number };

export type ModelPricing = {
  modelId: string;
  /** Base rates (standard speed, normal context). */
  base: Rates;
  /** Applied to every rate when the Fast param is on. */
  fastMultiplier?: number;
  /** Fast rates when Cursor lists them outright instead of as a multiple. */
  fastRates?: Rates;
  /**
   * Long context: when one model call's prompt is above `threshold` tokens,
   * the listed rates are multiplied (only input-side rates when `inputOnly`).
   * `fastMultiplier` is the combined factor for Fast + long context.
   */
  longContext?: { threshold: number; multiplier: number; fastMultiplier?: number; inputOnly: boolean };
  /**
   * Context window per `context` param value; `default` when the model has no
   * such param. Cursor publishes no window for Composer 2.5 or Gemini 4 Argon:
   * those values are our working assumption and only drive the context meter.
   */
  contextWindows: Record<string, number>;
  /** Shown next to the model: promotional or temporary pricing. */
  note?: string;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "composer-2.5": {
    modelId: "composer-2.5",
    // No separate cache-write price: Cursor bills cache writes as input.
    base: { input: 0.5, cacheWrite: 0.5, cacheRead: 0.2, output: 2.5 },
    fastRates: { input: 3, cacheWrite: 3, cacheRead: 0.5, output: 15 },
    contextWindows: { default: 200_000 },
  },
  "grok-4.7": {
    modelId: "grok-4.7",
    base: { input: 2, cacheWrite: 2, cacheRead: 0.5, output: 6 },
    fastMultiplier: 2,
    longContext: { threshold: 256_000, multiplier: 2, fastMultiplier: 3, inputOnly: false },
    contextWindows: { "256k": 256_000, "500k": 500_000 },
  },
  "gemini-4-argon": {
    modelId: "gemini-4-argon",
    base: { input: 2, cacheWrite: 2, cacheRead: 0.1, output: 10 },
    contextWindows: { default: 1_000_000 },
  },
  "claude-sonnet-5-5": {
    modelId: "claude-sonnet-5-5",
    // Same rates up to 1M tokens.
    base: { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
    contextWindows: { "300k": 300_000, "1m": 1_000_000 },
  },
  "gpt-5.6-sol": {
    modelId: "gpt-5.6-sol",
    base: { input: 4, cacheWrite: 5, cacheRead: 0.4, output: 20 },
    fastMultiplier: 2,
    longContext: { threshold: 272_000, multiplier: 2, fastMultiplier: 4, inputOnly: true },
    contextWindows: { "272k": 272_000, "1m": 1_000_000 },
    note: "Promotional pricing until November 21, 2026.",
  },
};

const param = (params: readonly ModelParam[], id: string) => params.find((p) => p.id === id)?.value;

export function isFast(params: readonly ModelParam[]): boolean {
  return param(params, "fast") === "true";
}

/** The context window the selected params give, in tokens. */
export function contextWindowFor(modelId: string, params: readonly ModelParam[]): number {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) return 200_000;
  const ctx = param(params, "context");
  return (ctx && pricing.contextWindows[ctx]) || pricing.contextWindows.default || Math.min(...Object.values(pricing.contextWindows));
}

/** Rates in effect for one model call. */
export function effectiveRates(modelId: string, params: readonly ModelParam[], promptTokensPerCall = 0): Rates {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) throw new Error(`No pricing for model ${modelId}`);
  if (isFast(params) && pricing.fastRates) return { ...pricing.fastRates };
  const fast = isFast(params) && !!pricing.fastMultiplier;
  const long = pricing.longContext && promptTokensPerCall > pricing.longContext.threshold ? pricing.longContext : null;

  let inputFactor = fast ? pricing.fastMultiplier! : 1;
  let outputFactor = inputFactor;
  if (long) {
    const combined = fast ? (long.fastMultiplier ?? long.multiplier * pricing.fastMultiplier!) : long.multiplier;
    inputFactor = combined;
    if (!long.inputOnly) outputFactor = combined;
  }
  const b = pricing.base;
  return {
    input: b.input * inputFactor,
    cacheWrite: b.cacheWrite * inputFactor,
    cacheRead: b.cacheRead * inputFactor,
    output: b.output * outputFactor,
  };
}

/**
 * Cost of a run's token usage in USD. `modelCalls` splits the prompt evenly
 * across the model calls in the run, to decide whether a call went over the
 * long-context threshold.
 */
export function estimateUsd(modelId: string, params: readonly ModelParam[], usage: TokenUsage, modelCalls = 1): number {
  const calls = Math.max(1, modelCalls);
  const cacheRead = Math.min(Math.max(0, usage.cacheReadTokens), Math.max(0, usage.inputTokens));
  const cacheWrite = Math.min(Math.max(0, usage.cacheWriteTokens), Math.max(0, usage.inputTokens - cacheRead));
  const fresh = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const rates = effectiveRates(modelId, params, usage.inputTokens / calls);
  return (
    (fresh * rates.input + cacheWrite * rates.cacheWrite + cacheRead * rates.cacheRead + Math.max(0, usage.outputTokens) * rates.output) /
    1_000_000
  );
}

/** 10 credits = $1, rounded up to 0.001 credit — the platform's rule. */
export function usdToCredits(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const milli = Math.round(usd * 10 * 1000 * 1e6) / 1e6;
  return Math.ceil(milli) / 1000;
}

/** Per-million prices for the model picker, in credits. */
export function priceSheet(modelId: string, params: readonly ModelParam[]) {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) return null;
  const r = effectiveRates(modelId, params);
  const long = pricing.longContext;
  return {
    creditsPerMillion: { input: r.input * 10, cacheRead: r.cacheRead * 10, cacheWrite: r.cacheWrite * 10, output: r.output * 10 },
    contextWindow: contextWindowFor(modelId, params),
    longContextNote: long
      ? `Prompts above ${Math.round(long.threshold / 1000)}K tokens cost ${long.multiplier}× ${long.inputOnly ? "on input" : ""}`.trim()
      : null,
    note: pricing.note ?? null,
  };
}
