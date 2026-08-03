// ─── AI API Pricing (Official, per 1M tokens in USD) ─────────────────
// Source: https://ai.google.dev/gemini-api/docs/pricing
// Last updated: 2026-04-02
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

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
  searchPerQuery: number;
  freeSearchQuota: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI GPT-5.6 Sol alias. Web/image search is $10 / 1k calls.
  "gpt-5.6": {
    inputPerMillion: 5.00,
    outputPerMillion: 30.00,
    cachedInputPerMillion: 0.50,
    searchPerQuery: 0.01,
    freeSearchQuota: 0,
  },
  "gpt-5.6-sol": {
    inputPerMillion: 5.00,
    outputPerMillion: 30.00,
    cachedInputPerMillion: 0.50,
    searchPerQuery: 0.01,
    freeSearchQuota: 0,
  },
  "gemini-3.1-flash-image": {
    inputPerMillion: 0.50,
    outputPerMillion: 3.00,
    cachedInputPerMillion: 0,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  "gemini-3-pro-image": {
    inputPerMillion: 2.00,
    outputPerMillion: 12.00,
    cachedInputPerMillion: 0,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  "gemini-3.1-pro-preview": {
    inputPerMillion: 2.00,
    outputPerMillion: 12.00,
    cachedInputPerMillion: 0.20,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  "gemini-3.1-flash-lite-preview": {
    inputPerMillion: 0.25,
    outputPerMillion: 1.50,
    cachedInputPerMillion: 0.025,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  "gemini-3-flash-preview": {
    inputPerMillion: 0.25,
    outputPerMillion: 1.50,
    cachedInputPerMillion: 0.025,
    searchPerQuery: 0.014,
    freeSearchQuota: 5000,
  },
  "gemini-3.5-flash": {
    inputPerMillion: 1.50,
    outputPerMillion: 9.00,
    cachedInputPerMillion: 0.15,
    searchPerQuery: 0.014,
    freeSearchQuota: 0,
  },
  // Official paid-tier pricing (verified 2026-07-29).
  "gemini-3.6-flash": {
    inputPerMillion: 1.50,
    outputPerMillion: 7.50,
    cachedInputPerMillion: 0.15,
    searchPerQuery: 0.014,
    freeSearchQuota: 0,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 2.00,
  outputPerMillion: 12.00,
  cachedInputPerMillion: 0.20,
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
  totalTokens: number;
}

export interface AiCallCost {
  model: string;
  usage: TokenUsage;
  usedGoogleSearch: boolean;
  inputCost: number;
  cachedInputCost: number;
  outputCost: number;
  searchCost: number;
  serperCost: number;
  serpApiCost: number;
  totalCost: number;
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

  // generateContent returns camelCase while Interactions returns snake_case.
  const promptTokens =
    usage.promptTokenCount ??
    usage.total_input_tokens ??
    usage.input_tokens ??
    0;
  const candidatesTokens =
    usage.candidatesTokenCount ??
    usage.total_output_tokens ??
    usage.output_tokens ??
    0;
  const thoughtsTokens =
    usage.thoughtsTokenCount ??
    usage.total_thought_tokens ??
    usage.thought_tokens ??
    0;
  const cachedTokens =
    usage.cachedContentTokenCount ??
    usage.total_cached_tokens ??
    usage.cached_tokens ??
    0;
  const totalTokens =
    usage.totalTokenCount ??
    usage.total_tokens ??
    promptTokens + candidatesTokens + thoughtsTokens;

  const nonCachedInput = Math.max(0, promptTokens - cachedTokens);

  const inputCost = (nonCachedInput / 1_000_000) * pricing.inputPerMillion;
  const cachedInputCost = (cachedTokens / 1_000_000) * pricing.cachedInputPerMillion;
  const outputTokensTotal = candidatesTokens + thoughtsTokens;
  const outputCost = (outputTokensTotal / 1_000_000) * pricing.outputPerMillion;
  const queries = Math.max(0, Math.floor(searchQueryCount));
  const searchCost = queries * pricing.searchPerQuery;

  const totalCost = inputCost + cachedInputCost + outputCost + searchCost;

  return {
    model,
    usage: { promptTokens, candidatesTokens, thoughtsTokens, cachedTokens, totalTokens },
    usedGoogleSearch: queries > 0,
    inputCost,
    cachedInputCost,
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
    usage: { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0 },
    usedGoogleSearch: false,
    inputCost: 0,
    cachedInputCost: 0,
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
      totalTokens: 0,
    },
    usedGoogleSearch: false,
    inputCost: 0,
    cachedInputCost: 0,
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
    outputCost: number;
    searchCost: number;
    serperCost: number;
    serpApiCost: number;
  };
} {
  let totalTokens = 0;
  let inputCost = 0;
  let cachedInputCost = 0;
  let outputCost = 0;
  let searchCost = 0;
  let serperCost = 0;
  let serpApiCost = 0;

  for (const c of costs) {
    totalTokens += c.usage.totalTokens;
    inputCost += c.inputCost;
    cachedInputCost += c.cachedInputCost;
    outputCost += c.outputCost;
    searchCost += c.searchCost;
    serperCost += c.serperCost;
    serpApiCost += c.serpApiCost ?? 0;
  }

  const totalCost =
    inputCost + cachedInputCost + outputCost + searchCost + serperCost + serpApiCost;

  return {
    totalTokens,
    totalCost,
    totalCredits: costToCredits(totalCost),
    breakdown: {
      inputCost,
      cachedInputCost,
      outputCost,
      searchCost,
      serperCost,
      serpApiCost,
    },
  };
}
