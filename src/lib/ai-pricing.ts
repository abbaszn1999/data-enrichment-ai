// ─── AI API Pricing (Official, per 1M tokens in USD) ─────────────────
// Gemini source: https://ai.google.dev/gemini-api/docs/pricing
// OpenAI source: https://developers.openai.com/api/docs/pricing
// OpenAI GPT-5.6 Sol/Terra verified against official table (2026-08-04):
//   Short context | Long context (>272K input tokens, full-request uplift)
//   Model           Input  Cached  Cache writes  Output | Input  Cached  Cache writes  Output
//   gpt-5.6-sol     $5.00  $0.50   $6.25         $30.00 | $10.00 $1.00   $12.50        $45.00
//   gpt-5.6-terra   $2.00  $0.20   $2.50         $12.00 | $4.00  $0.40   $5.00         $18.00
//
// ─── Serper.dev Pricing ──────────────────────────────────────────────
// Source: https://serper.dev/ (top-up model, no subscription)
// $50 = 50k credits = $0.001 per query
// $375 = 500k credits = $0.00075 per query
// $1250 = 2.5M credits = $0.0005 per query
// We use the $50 tier rate: $0.001 per image search query
export const SERPER_COST_PER_QUERY = 0.001; // $0.001 per search query

// ─── SerpApi Pricing ─────────────────────────────────────────────────
// Source: https://serpapi.com/pricing (subscription, billed per successful search)
// Starter $25 / 1,000 searches = $0.025 per search (conservative billable rate).
// Volume plans drop toward ~$0.009–$0.015; we keep Starter so preflight never underquotes.
export const SERPAPI_COST_PER_SEARCH = 0.025;

/** OpenAI GPT-5.6 long-context threshold (input tokens). */
export const OPENAI_LONG_CONTEXT_INPUT_TOKENS = 272_000;

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
  /** Prompt-cache writes (1.25× uncached input for GPT-5.6). */
  cacheWritePerMillion?: number;
  /** When set, requests whose input tokens exceed this use the long-* rates. */
  longContextThresholdTokens?: number;
  longInputPerMillion?: number;
  longOutputPerMillion?: number;
  longCachedInputPerMillion?: number;
  longCacheWritePerMillion?: number;
  searchPerQuery: number;
  freeSearchQuota: number;
}

function openAiGpt56Pricing(params: {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  longInput: number;
  longCached: number;
  longCacheWrite: number;
  longOutput: number;
}): ModelPricing {
  return {
    inputPerMillion: params.input,
    cachedInputPerMillion: params.cached,
    cacheWritePerMillion: params.cacheWrite,
    outputPerMillion: params.output,
    longContextThresholdTokens: OPENAI_LONG_CONTEXT_INPUT_TOKENS,
    longInputPerMillion: params.longInput,
    longCachedInputPerMillion: params.longCached,
    longCacheWritePerMillion: params.longCacheWrite,
    longOutputPerMillion: params.longOutput,
    // Hosted web/image search: $10 / 1k calls = $0.01 per call
    searchPerQuery: 0.01,
    freeSearchQuota: 0,
  };
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // gpt-5.6 alias routes to Sol per OpenAI docs.
  "gpt-5.6": openAiGpt56Pricing({
    input: 5.0,
    cached: 0.5,
    cacheWrite: 6.25,
    output: 30.0,
    longInput: 10.0,
    longCached: 1.0,
    longCacheWrite: 12.5,
    longOutput: 45.0,
  }),
  "gpt-5.6-sol": openAiGpt56Pricing({
    input: 5.0,
    cached: 0.5,
    cacheWrite: 6.25,
    output: 30.0,
    longInput: 10.0,
    longCached: 1.0,
    longCacheWrite: 12.5,
    longOutput: 45.0,
  }),
  "gpt-5.6-terra": openAiGpt56Pricing({
    input: 2.0,
    cached: 0.2,
    cacheWrite: 2.5,
    output: 12.0,
    longInput: 4.0,
    longCached: 0.4,
    longCacheWrite: 5.0,
    longOutput: 18.0,
  }),
  "gemini-3.1-flash-image": {
    inputPerMillion: 0.5,
    outputPerMillion: 3.0,
    cachedInputPerMillion: 0,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  "gemini-3-pro-image": {
    inputPerMillion: 2.0,
    outputPerMillion: 12.0,
    cachedInputPerMillion: 0,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  // Official paid-tier: $2/$12 up to 200k input tokens, $4/$18 above.
  "gemini-3.1-pro-preview": {
    inputPerMillion: 2.0,
    outputPerMillion: 12.0,
    cachedInputPerMillion: 0.2,
    longContextThresholdTokens: 200_000,
    longInputPerMillion: 4.0,
    longOutputPerMillion: 18.0,
    longCachedInputPerMillion: 0.4,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  "gemini-3.1-flash-lite-preview": {
    inputPerMillion: 0.25,
    outputPerMillion: 1.5,
    cachedInputPerMillion: 0.025,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  // Official paid-tier (Gemini API pricing). Preview Fast path; prefer gemini-3.6-flash.
  "gemini-3-flash-preview": {
    inputPerMillion: 0.5,
    outputPerMillion: 3.0,
    cachedInputPerMillion: 0.05,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  "gemini-3.5-flash": {
    inputPerMillion: 1.5,
    outputPerMillion: 9.0,
    cachedInputPerMillion: 0.15,
    searchPerQuery: 0.014,
    freeSearchQuota: 0,
  },
  // Official paid-tier (verified 2026-08 against ai.google.dev/gemini-api/docs/pricing).
  "gemini-3.5-flash-lite": {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
    cachedInputPerMillion: 0.03,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  // Official paid-tier pricing (verified 2026-07-29).
  "gemini-3.6-flash": {
    inputPerMillion: 1.5,
    outputPerMillion: 7.5,
    cachedInputPerMillion: 0.15,
    searchPerQuery: 0.014,
    freeSearchQuota: 0,
  },
  // Gemini 3.7 Flash official pricing
  "gemini-3.7-flash": {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
    cachedInputPerMillion: 0.01875,
    searchPerQuery: 0.035,
    freeSearchQuota: 1500,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 2.0,
  outputPerMillion: 12.0,
  cachedInputPerMillion: 0.2,
  searchPerQuery: 0.014,
  freeSearchQuota: 5000,
};

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] || DEFAULT_PRICING;
}

// ─── Token Usage ─────────────────────────────────────────────────────

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface AiCallCost {
  model: string;
  usage: TokenUsage;
  usedGoogleSearch: boolean;
  inputCost: number;
  cachedInputCost: number;
  cacheWriteCost: number;
  outputCost: number;
  searchCost: number;
  serperCost: number;
  serpApiCost: number;
  totalCost: number;
}

function readUsageNumber(
  usage: Record<string, number | undefined>,
  ...keys: string[]
): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * Calculate the dollar cost of a single Gemini API call from usageMetadata.
 */
export function calculateCallCost(
  model: string,
  usageMetadata: unknown,
  usedGoogleSearch: boolean = false
): AiCallCost {
  return calculateGroundedCallCost(
    model,
    usageMetadata,
    usedGoogleSearch ? 1 : 0
  );
}

/**
 * Token cost plus N Grounding-with-Google-Search queries (Gemini 3 billing).
 * Also used for OpenAI Responses: supports cache reads/writes and long-context
 * uplift when the model pricing defines long-* rates.
 */
export function calculateGroundedCallCost(
  model: string,
  usageMetadata: unknown,
  searchQueryCount: number = 0
): AiCallCost {
  const pricing = getModelPricing(model);
  const usage =
    usageMetadata && typeof usageMetadata === "object"
      ? (usageMetadata as Record<string, number | undefined>)
      : {};

  // generateContent returns camelCase while Interactions/OpenAI return snake_case.
  const promptTokens = readUsageNumber(
    usage,
    "promptTokenCount",
    "total_input_tokens",
    "input_tokens"
  );
  const candidatesTokens = readUsageNumber(
    usage,
    "candidatesTokenCount",
    "total_output_tokens",
    "output_tokens"
  );
  const thoughtsTokens = readUsageNumber(
    usage,
    "thoughtsTokenCount",
    "total_thought_tokens",
    "thought_tokens"
  );
  const cachedTokens = readUsageNumber(
    usage,
    "cachedContentTokenCount",
    "total_cached_tokens",
    "cached_tokens"
  );
  const cacheWriteTokens = readUsageNumber(
    usage,
    "cacheWriteTokenCount",
    "cache_write_tokens",
    "cache_creation_tokens",
    "cache_creation_input_tokens"
  );
  const totalTokens =
    readUsageNumber(usage, "totalTokenCount", "total_tokens") ||
    promptTokens + candidatesTokens + thoughtsTokens;

  const threshold = pricing.longContextThresholdTokens;
  const useLongContext =
    typeof threshold === "number" &&
    threshold > 0 &&
    promptTokens > threshold &&
    typeof pricing.longInputPerMillion === "number";

  const inputRate = useLongContext
    ? pricing.longInputPerMillion!
    : pricing.inputPerMillion;
  const cachedRate = useLongContext
    ? (pricing.longCachedInputPerMillion ?? pricing.cachedInputPerMillion)
    : pricing.cachedInputPerMillion;
  const cacheWriteRate = useLongContext
    ? (pricing.longCacheWritePerMillion ??
      pricing.cacheWritePerMillion ??
      inputRate * 1.25)
    : (pricing.cacheWritePerMillion ?? inputRate * 1.25);
  const outputRate = useLongContext
    ? (pricing.longOutputPerMillion ?? pricing.outputPerMillion)
    : pricing.outputPerMillion;

  const safeCached = Math.min(Math.max(0, cachedTokens), Math.max(0, promptTokens));
  const safeCacheWrite = Math.min(
    Math.max(0, cacheWriteTokens),
    Math.max(0, promptTokens - safeCached)
  );
  const nonCachedInput = Math.max(0, promptTokens - safeCached - safeCacheWrite);

  const inputCost = (nonCachedInput / 1_000_000) * inputRate;
  const cachedInputCost = (safeCached / 1_000_000) * cachedRate;
  const cacheWriteCost = (safeCacheWrite / 1_000_000) * cacheWriteRate;
  const outputTokensTotal = candidatesTokens + thoughtsTokens;
  const outputCost = (outputTokensTotal / 1_000_000) * outputRate;
  const queries = Math.max(0, Math.floor(searchQueryCount));
  const searchCost = queries * pricing.searchPerQuery;

  const totalCost =
    inputCost + cachedInputCost + cacheWriteCost + outputCost + searchCost;

  return {
    model,
    usage: {
      promptTokens,
      candidatesTokens,
      thoughtsTokens,
      cachedTokens: safeCached,
      cacheWriteTokens: safeCacheWrite,
      totalTokens,
    },
    usedGoogleSearch: queries > 0,
    inputCost,
    cachedInputCost,
    cacheWriteCost,
    outputCost,
    searchCost,
    serperCost: 0,
    serpApiCost: 0,
    totalCost,
  };
}

/**
 * OpenAI Responses token cost plus hosted web/image-search calls.
 * The common usage fields are already supported by calculateGroundedCallCost.
 */
export function calculateOpenAiWebSearchCost(
  model: string,
  usage: unknown,
  searchCallCount: number
): AiCallCost {
  const normalized =
    usage && typeof usage === "object"
      ? (() => {
          const source = usage as Record<string, unknown>;
          const details =
            source.input_tokens_details &&
            typeof source.input_tokens_details === "object"
              ? (source.input_tokens_details as Record<string, unknown>)
              : {};
          return {
            ...source,
            cached_tokens:
              typeof source.cached_tokens === "number"
                ? source.cached_tokens
                : typeof details.cached_tokens === "number"
                  ? details.cached_tokens
                  : 0,
            cache_write_tokens:
              typeof source.cache_write_tokens === "number"
                ? source.cache_write_tokens
                : typeof details.cache_write_tokens === "number"
                  ? details.cache_write_tokens
                  : typeof details.cache_creation_tokens === "number"
                    ? details.cache_creation_tokens
                    : 0,
          };
        })()
      : usage;
  return calculateGroundedCallCost(model, normalized, searchCallCount);
}

const IMAGE_OUTPUT_COST_USD: Record<string, Record<string, number>> = {
  "gemini-3.1-flash-image": {
    "0.5K": 0.045,
    "1K": 0.067,
    "2K": 0.101,
    "4K": 0.151,
  },
  "gemini-3-pro-image": {
    "1K": 0.134,
    "2K": 0.134,
    "4K": 0.24,
  },
};

/**
 * Image output uses a separate token rate from text/thinking output. The
 * Interactions usage aggregate does not reliably separate image output tokens,
 * so use Google's published per-image equivalent and add measured input and
 * thinking costs without double-charging image tokens as text.
 */
export function createImageGenerationCost(
  model: "gemini-3.1-flash-image" | "gemini-3-pro-image",
  resolution: string,
  usageMetadata: unknown,
  googleSearchQueries: number | boolean = 0
): AiCallCost {
  const measured = calculateCallCost(model, usageMetadata, false);
  const pricing = getModelPricing(model);
  const fallbackResolution = model === "gemini-3-pro-image" ? "1K" : "1K";
  const imageCost =
    IMAGE_OUTPUT_COST_USD[model]?.[resolution] ??
    IMAGE_OUTPUT_COST_USD[model][fallbackResolution];
  const thinkingCost =
    (measured.usage.thoughtsTokens / 1_000_000) * pricing.outputPerMillion;
  const searchQueryCount =
    typeof googleSearchQueries === "number"
      ? Math.max(0, googleSearchQueries)
      : googleSearchQueries
        ? 1
        : 0;
  const searchCost = searchQueryCount * pricing.searchPerQuery;
  return {
    ...measured,
    usedGoogleSearch: searchQueryCount > 0,
    outputCost: imageCost + thinkingCost,
    searchCost,
    totalCost:
      measured.inputCost +
      measured.cachedInputCost +
      measured.cacheWriteCost +
      imageCost +
      thinkingCost +
      searchCost,
  };
}

export function getImageOutputCost(
  model: "gemini-3.1-flash-image" | "gemini-3-pro-image",
  resolution: string
): number {
  return (
    IMAGE_OUTPUT_COST_USD[model]?.[resolution] ??
    IMAGE_OUTPUT_COST_USD[model]["1K"]
  );
}

/**
 * Create an AiCallCost entry for a Serper.dev image search query.
 */
export function createSerperCost(queryCount: number = 1): AiCallCost {
  const cost = queryCount * SERPER_COST_PER_QUERY;
  return {
    model: "serper-image-search",
    usage: {
      promptTokens: 0,
      candidatesTokens: 0,
      thoughtsTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    },
    usedGoogleSearch: false,
    inputCost: 0,
    cachedInputCost: 0,
    cacheWriteCost: 0,
    outputCost: 0,
    searchCost: 0,
    serperCost: cost,
    serpApiCost: 0,
    totalCost: cost,
  };
}

/**
 * Create an AiCallCost entry for a SerpApi search (Google Images or Google Lens).
 */
export function createSerpApiCost(searchCount: number = 1): AiCallCost {
  const cost = Math.max(0, searchCount) * SERPAPI_COST_PER_SEARCH;
  return {
    model: "serpapi-search",
    usage: {
      promptTokens: 0,
      candidatesTokens: 0,
      thoughtsTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    },
    usedGoogleSearch: false,
    inputCost: 0,
    cachedInputCost: 0,
    cacheWriteCost: 0,
    outputCost: 0,
    searchCost: 0,
    serperCost: 0,
    serpApiCost: cost,
    totalCost: cost,
  };
}

/**
 * Convert dollar cost to credits.
 * 10 credits = $1 (1 credit = $0.10)
 * Example: $0.075 = 0.750 credits, $1.00 = 10.000 credits
 */
export function costToCredits(dollarCost: number): number {
  return Math.ceil(dollarCost * 10 * 1000) / 1000;
}

export function creditsToDollars(credits: number): number {
  return credits / 10;
}

/**
 * Sum multiple AiCallCost objects into one aggregate.
 */
export function sumCosts(costs: AiCallCost[]): {
  totalTokens: number;
  totalCost: number;
  totalCredits: number;
  breakdown: {
    inputCost: number;
    cachedInputCost: number;
    cacheWriteCost: number;
    outputCost: number;
    searchCost: number;
    serperCost: number;
    serpApiCost: number;
  };
} {
  let totalTokens = 0;
  let inputCost = 0;
  let cachedInputCost = 0;
  let cacheWriteCost = 0;
  let outputCost = 0;
  let searchCost = 0;
  let serperCost = 0;
  let serpApiCost = 0;

  for (const c of costs) {
    totalTokens += c.usage.totalTokens;
    inputCost += c.inputCost;
    cachedInputCost += c.cachedInputCost;
    cacheWriteCost += c.cacheWriteCost ?? 0;
    outputCost += c.outputCost;
    searchCost += c.searchCost;
    serperCost += c.serperCost;
    serpApiCost += c.serpApiCost ?? 0;
  }

  const totalCost =
    inputCost +
    cachedInputCost +
    cacheWriteCost +
    outputCost +
    searchCost +
    serperCost +
    serpApiCost;

  return {
    totalTokens,
    totalCost,
    totalCredits: costToCredits(totalCost),
    breakdown: {
      inputCost,
      cachedInputCost,
      cacheWriteCost,
      outputCost,
      searchCost,
      serperCost,
      serpApiCost,
    },
  };
}
