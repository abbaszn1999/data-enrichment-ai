import { describe, expect, it } from "vitest";
import {
  calculateGroundedCallCost,
  calculateOpenAiWebSearchCost,
  getModelPricing,
  OPENAI_LONG_CONTEXT_INPUT_TOKENS,
} from "@/lib/ai-pricing";
import {
  GALLERY_SCRAPING_MODELS,
  resolveScrapingModel,
} from "@/lib/gallery/agents/scraping-shared";
import { estimateScrapingCreditRange } from "@/lib/gallery/pricing";

describe("OpenAI GPT-5.6 Sol/Terra official pricing", () => {
  it("matches OpenAI short-context rates for Sol and Terra", () => {
    expect(getModelPricing("gpt-5.6-sol")).toMatchObject({
      inputPerMillion: 5.0,
      cachedInputPerMillion: 0.5,
      cacheWritePerMillion: 6.25,
      outputPerMillion: 30.0,
      longInputPerMillion: 10.0,
      longCachedInputPerMillion: 1.0,
      longCacheWritePerMillion: 12.5,
      longOutputPerMillion: 45.0,
      searchPerQuery: 0.01,
      longContextThresholdTokens: OPENAI_LONG_CONTEXT_INPUT_TOKENS,
    });
    expect(getModelPricing("gpt-5.6-terra")).toMatchObject({
      inputPerMillion: 2.0,
      cachedInputPerMillion: 0.2,
      cacheWritePerMillion: 2.5,
      outputPerMillion: 12.0,
      longInputPerMillion: 4.0,
      longCachedInputPerMillion: 0.4,
      longCacheWritePerMillion: 5.0,
      longOutputPerMillion: 18.0,
      searchPerQuery: 0.01,
      longContextThresholdTokens: OPENAI_LONG_CONTEXT_INPUT_TOKENS,
    });
    expect(getModelPricing("gpt-5.6")).toEqual(getModelPricing("gpt-5.6-sol"));
  });

  it("bills Terra short-context tokens exactly", () => {
    const cost = calculateGroundedCallCost(
      "gpt-5.6-terra",
      {
        input_tokens: 100_000,
        output_tokens: 100_000,
        cached_tokens: 0,
      },
      0
    );
    expect(cost.inputCost).toBeCloseTo(0.2, 10);
    expect(cost.outputCost).toBeCloseTo(1.2, 10);
    expect(cost.totalCost).toBeCloseTo(1.4, 10);
  });

  it("bills Sol short-context tokens exactly", () => {
    const cost = calculateGroundedCallCost(
      "gpt-5.6-sol",
      {
        input_tokens: 100_000,
        output_tokens: 100_000,
        cached_tokens: 0,
      },
      0
    );
    expect(cost.inputCost).toBeCloseTo(0.5, 10);
    expect(cost.outputCost).toBeCloseTo(3.0, 10);
    expect(cost.totalCost).toBeCloseTo(3.5, 10);
  });

  it("applies cached-input and cache-write rates for Terra", () => {
    const cost = calculateOpenAiWebSearchCost(
      "gpt-5.6-terra",
      {
        input_tokens: 100_000,
        output_tokens: 0,
        input_tokens_details: {
          cached_tokens: 40_000,
          cache_write_tokens: 10_000,
        },
      },
      2
    );
    // 50k uncached @ $2 + 40k cached @ $0.20 + 10k write @ $2.50 + 2 searches @ $0.01
    expect(cost.inputCost).toBeCloseTo(0.1, 10);
    expect(cost.cachedInputCost).toBeCloseTo(0.008, 10);
    expect(cost.cacheWriteCost).toBeCloseTo(0.025, 10);
    expect(cost.searchCost).toBeCloseTo(0.02, 10);
    expect(cost.totalCost).toBeCloseTo(0.153, 10);
  });

  it("switches to long-context rates when input exceeds 272K", () => {
    const cost = calculateGroundedCallCost(
      "gpt-5.6-terra",
      {
        input_tokens: OPENAI_LONG_CONTEXT_INPUT_TOKENS + 1,
        output_tokens: 100_000,
        cached_tokens: 0,
      },
      0
    );
    expect(cost.inputCost).toBeCloseTo(
      ((OPENAI_LONG_CONTEXT_INPUT_TOKENS + 1) / 1_000_000) * 4.0,
      8
    );
    expect(cost.outputCost).toBeCloseTo(1.8, 10);
  });
});

describe("scraping tier model routing", () => {
  it("maps Standard to Terra and Premium to Sol", () => {
    expect(resolveScrapingModel("standard")).toBe("gpt-5.6-terra");
    expect(resolveScrapingModel("premium")).toBe("gpt-5.6-sol");
    expect(resolveScrapingModel(undefined)).toBe(GALLERY_SCRAPING_MODELS.standard);
  });

  it("estimates Premium scraping higher than Standard", () => {
    const standard = estimateScrapingCreditRange({
      rowCount: 5,
      tier: "standard",
    });
    const premium = estimateScrapingCreditRange({
      rowCount: 5,
      tier: "premium",
    });
    expect(premium.max).toBeGreaterThan(standard.max);
  });
});
