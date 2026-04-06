// ─── Gemini API Pricing (Official, per 1M tokens in USD) ─────────────
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

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
  searchPerQuery: number;
  freeSearchQuota: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
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
  totalCost: number;
}

/**
 * Calculate the dollar cost of a single Gemini API call from usageMetadata.
 */
export function calculateCallCost(
  model: string,
  usageMetadata: any,
  usedGoogleSearch: boolean = false
): AiCallCost {
  const pricing = getModelPricing(model);

  const promptTokens = usageMetadata?.promptTokenCount ?? 0;
  const candidatesTokens = usageMetadata?.candidatesTokenCount ?? 0;
  const thoughtsTokens = usageMetadata?.thoughtsTokenCount ?? 0;
  const cachedTokens = usageMetadata?.cachedContentTokenCount ?? 0;
  const totalTokens = usageMetadata?.totalTokenCount ?? 0;

  const nonCachedInput = Math.max(0, promptTokens - cachedTokens);

  const inputCost = (nonCachedInput / 1_000_000) * pricing.inputPerMillion;
  const cachedInputCost = (cachedTokens / 1_000_000) * pricing.cachedInputPerMillion;
  const outputTokensTotal = candidatesTokens + thoughtsTokens;
  const outputCost = (outputTokensTotal / 1_000_000) * pricing.outputPerMillion;
  const searchCost = usedGoogleSearch ? pricing.searchPerQuery : 0;

  const totalCost = inputCost + cachedInputCost + outputCost + searchCost;

  return {
    model,
    usage: { promptTokens, candidatesTokens, thoughtsTokens, cachedTokens, totalTokens },
    usedGoogleSearch,
    inputCost,
    cachedInputCost,
    outputCost,
    searchCost,
    serperCost: 0,
    totalCost,
  };
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
  breakdown: { inputCost: number; cachedInputCost: number; outputCost: number; searchCost: number; serperCost: number };
} {
  let totalTokens = 0;
  let inputCost = 0;
  let cachedInputCost = 0;
  let outputCost = 0;
  let searchCost = 0;
  let serperCost = 0;

  for (const c of costs) {
    totalTokens += c.usage.totalTokens;
    inputCost += c.inputCost;
    cachedInputCost += c.cachedInputCost;
    outputCost += c.outputCost;
    searchCost += c.searchCost;
    serperCost += c.serperCost;
  }

  const totalCost = inputCost + cachedInputCost + outputCost + searchCost + serperCost;

  return {
    totalTokens,
    totalCost,
    totalCredits: costToCredits(totalCost),
    breakdown: { inputCost, cachedInputCost, outputCost, searchCost, serperCost },
  };
}
