import { describe, expect, it } from "vitest";
import { calculateOpenAiWebSearchCost } from "@/lib/ai-pricing";
import {
  GALLERY_ESTIMATE_PROFILES,
  estimateGalleryResearchRowCost,
  estimateScrapingCreditRange,
} from "./pricing";

describe("gallery scraping estimate", () => {
  it("is one stage per row and scales linearly with rows", () => {
    const one = estimateScrapingCreditRange({ rowCount: 1, searchDepth: "medium" });
    const ten = estimateScrapingCreditRange({ rowCount: 10, searchDepth: "medium" });
    expect(one.min).toBeGreaterThan(0);
    expect(one.max).toBeGreaterThan(one.min);
    expect(ten.min).toBeCloseTo(one.min * 10, 1);
    expect(ten.max).toBeCloseTo(one.max * 10, 1);
  });

  it("costs more for deeper research and is zero for no rows", () => {
    const low = estimateScrapingCreditRange({ rowCount: 5, searchDepth: "low" });
    const high = estimateScrapingCreditRange({ rowCount: 5, searchDepth: "high" });
    expect(high.max).toBeGreaterThan(low.max);
    expect(estimateScrapingCreditRange({ rowCount: 0, searchDepth: "high" })).toMatchObject({ min: 0, max: 0 });
  });

  it("prices each modeled round with the real gpt-6.1-sol calculator", () => {
    const profile = { rounds: 1, searches: 1 };
    const expected = calculateOpenAiWebSearchCost(
      "gpt-6.1-sol",
      { input_tokens: 9_000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1_500 },
      1
    ).totalCost;
    expect(estimateGalleryResearchRowCost(profile)).toBeCloseTo(expected, 10);
  });

  it("keeps the high case within a sane per-row credit range", () => {
    for (const depth of ["low", "medium", "high"] as const) {
      const range = estimateScrapingCreditRange({ rowCount: 1, searchDepth: depth });
      expect(range.max).toBeLessThan(10);
      expect(GALLERY_ESTIMATE_PROFILES[depth].high.rounds).toBeGreaterThan(GALLERY_ESTIMATE_PROFILES[depth].expected.rounds);
    }
  });
});
