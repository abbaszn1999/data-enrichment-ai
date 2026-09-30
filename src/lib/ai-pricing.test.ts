import { describe, expect, it } from "vitest";
import {
  MODEL_PRICING,
  SEARCHAPI_COST_PER_SEARCH,
  calculateOpenAiWebSearchCost,
  costToCredits,
  createSearchApiCost,
  sumCosts,
} from "./ai-pricing";
import { ENRICHMENT_OPENAI_MODELS } from "./enrich/models";

describe("gpt-6-sol pricing", () => {
  it("prices a normal request with cache reads, cache writes, reasoning and searches", () => {
    const cost = calculateOpenAiWebSearchCost(
      "gpt-6-sol",
      {
        input_tokens: 10_000,
        input_tokens_details: { cached_tokens: 4_000, cache_write_tokens: 1_000 },
        output_tokens: 3_000,
        output_tokens_details: { reasoning_tokens: 2_000 },
        total_tokens: 13_000,
      },
      2
    );

    expect(cost.inputCost).toBeCloseTo(0.01, 10); // 5,000 uncached × $2/M
    expect(cost.cachedInputCost).toBeCloseTo(0.0008, 10); // 4,000 × $0.20/M
    expect(cost.cacheWriteCost).toBeCloseTo(0.0025, 10); // 1,000 × $2.50/M
    // output_tokens already includes reasoning tokens; they are not added twice.
    expect(cost.outputCost).toBeCloseTo(0.03, 10); // 3,000 × $10/M
    expect(cost.searchCost).toBeCloseTo(0.02, 10); // 2 × $0.01
    expect(cost.totalCost).toBeCloseTo(0.0633, 10);
    expect(cost.usage.totalTokens).toBe(13_000);
  });

  it("uses long-context rates for the whole request above 272K input tokens", () => {
    const cost = calculateOpenAiWebSearchCost(
      "gpt-6-sol",
      {
        input_tokens: 300_000,
        input_tokens_details: { cached_tokens: 100_000 },
        output_tokens: 1_000,
      },
      0
    );
    expect(cost.inputCost).toBeCloseTo(0.8, 10); // 200,000 × $4/M
    expect(cost.cachedInputCost).toBeCloseTo(0.04, 10); // 100,000 × $0.40/M
    expect(cost.outputCost).toBeCloseTo(0.015, 10); // 1,000 × $15/M
    expect(cost.totalCost).toBeCloseTo(0.855, 10);
  });

  it("keeps normal rates at exactly 272K input tokens", () => {
    const cost = calculateOpenAiWebSearchCost(
      "gpt-6-sol",
      { input_tokens: 272_000, output_tokens: 0 },
      0
    );
    expect(cost.inputCost).toBeCloseTo(0.544, 10);
  });

  it("has an explicit price for every enrichment model (no silent default)", () => {
    for (const model of Object.values(ENRICHMENT_OPENAI_MODELS)) {
      expect(MODEL_PRICING[model], model).toBeDefined();
    }
  });
});

describe("costToCredits", () => {
  it("converts at 10 credits per dollar without float bumps", () => {
    expect(costToCredits(0.07)).toBe(0.7);
    expect(costToCredits(0.0633)).toBe(0.633);
    expect(costToCredits(1)).toBe(10);
    expect(costToCredits(0)).toBe(0);
  });

  it("rounds genuine fractions up to the next 0.001 credit", () => {
    expect(costToCredits(0.00001)).toBe(0.001);
    expect(costToCredits(0.07001)).toBe(0.701);
  });

  it("sums multiple billed calls before converting", () => {
    const call = calculateOpenAiWebSearchCost(
      "gpt-6-sol",
      { input_tokens: 1_000, output_tokens: 1_000 },
      1
    );
    const summed = sumCosts([call, call]);
    // (1,000 × $2/M + 1,000 × $10/M + $0.01) × 2 = $0.044
    expect(summed.totalCost).toBeCloseTo(0.044, 10);
    expect(summed.totalCredits).toBe(0.44);
    expect(summed.totalTokens).toBe(4_000);
  });

  it("includes SearchApi cost (Image Finder Exact Match Agent 1) in the total", () => {
    const openAiCall = calculateOpenAiWebSearchCost(
      "gpt-6-sol",
      { input_tokens: 1_000, output_tokens: 1_000 },
      0
    );
    const searchApiCall = createSearchApiCost(1);
    expect(searchApiCall.searchApiCost).toBeCloseTo(SEARCHAPI_COST_PER_SEARCH, 10);
    expect(searchApiCall.totalCost).toBeCloseTo(SEARCHAPI_COST_PER_SEARCH, 10);

    const summed = sumCosts([openAiCall, searchApiCall]);
    expect(summed.breakdown.searchApiCost).toBeCloseTo(SEARCHAPI_COST_PER_SEARCH, 10);
    expect(summed.totalCost).toBeCloseTo(0.012 + SEARCHAPI_COST_PER_SEARCH, 10); // 1,000×$2/M + 1,000×$10/M
  });

  it("never bills for a failed SearchApi search", () => {
    expect(createSearchApiCost(0).totalCost).toBe(0);
  });
});

describe("reasoning tokens and call counts", () => {
  it("splitting reasoning tokens out for the breakdown does not change the price", () => {
    const plain = calculateOpenAiWebSearchCost("gpt-6-sol", { input_tokens: 5_000, output_tokens: 4_000 }, 2);
    const split = calculateOpenAiWebSearchCost(
      "gpt-6-sol",
      { input_tokens: 5_000, output_tokens: 4_000, output_tokens_details: { reasoning_tokens: 3_000 } },
      2
    );
    expect(split.totalCost).toBeCloseTo(plain.totalCost, 12);
    expect(split.usage.thoughtsTokens).toBe(3_000);
    expect(split.usage.candidatesTokens).toBe(1_000);
    expect(split.usage.totalTokens).toBe(plain.usage.totalTokens);
  });

  it("ignores impossible reasoning counts instead of guessing", () => {
    const cost = calculateOpenAiWebSearchCost(
      "gpt-6-sol",
      { input_tokens: 100, output_tokens: 50, output_tokens_details: { reasoning_tokens: 500 } },
      0
    );
    expect(cost.usage.thoughtsTokens).toBe(0);
  });

  it("records web-search and SearchApi call counts and sums them across tiers", () => {
    const openAi = calculateOpenAiWebSearchCost("gpt-6-sol", { input_tokens: 100, output_tokens: 50 }, 3);
    expect(openAi.webSearchCalls).toBe(3);
    const summed = sumCosts([openAi, createSearchApiCost(1), createSearchApiCost(2), openAi]);
    expect(summed.breakdown.webSearchCalls).toBe(6);
    expect(summed.breakdown.searchApiCalls).toBe(3);
    expect(summed.totalCost).toBeCloseTo(openAi.totalCost * 2 + SEARCHAPI_COST_PER_SEARCH * 3, 10);
  });
});
