import { describe, expect, it } from "vitest";
import { createImageGenerationCost, readImageOutputTokens, sumCosts } from "@/lib/ai-pricing";

function usage(input: number, imageTokens: number, thought = 0, textOut = 0) {
  return {
    total_input_tokens: input,
    total_output_tokens: imageTokens + textOut,
    total_thought_tokens: thought,
    output_tokens_by_modality: [{ modality: "image", tokens: imageTokens }],
  };
}

describe("createImageGenerationCost", () => {
  it.each([
    ["gemini-3.1-flash-image", "512", 747, 0.04482],
    ["gemini-3.1-flash-image", "1K", 1120, 0.0672],
    ["gemini-3.1-flash-image", "2K", 1680, 0.1008],
    ["gemini-3.1-flash-image", "4K", 2520, 0.1512],
    ["gemini-3-pro-image", "1K", 1120, 0.1344],
    ["gemini-3-pro-image", "2K", 1120, 0.1344],
    ["gemini-3-pro-image", "4K", 2000, 0.24],
  ] as const)("prices %s %s from image output tokens", (model, size, tokens, expected) => {
    const cost = createImageGenerationCost(model, size, usage(0, tokens));
    expect(cost.totalCost).toBeCloseTo(expected, 6);
    expect(cost.imageCostSource).toBe("usage");
    expect(cost.imageOutputTokens).toBe(tokens);
  });

  it("adds input, thinking and text output at their own rates", () => {
    // NB2: 2,800 input at $0.50/M, 1,000 thinking + 50 text at $3/M, 1,120 image tokens at $60/M
    const cost = createImageGenerationCost("gemini-3.1-flash-image", "1K", usage(2800, 1120, 1000, 50));
    const expected = (2800 / 1e6) * 0.5 + (1050 / 1e6) * 3 + (1120 / 1e6) * 60;
    expect(cost.totalCost).toBeCloseTo(expected, 8);
  });

  it("falls back to the published per-image price when the modality breakdown is missing", () => {
    const cost = createImageGenerationCost("gemini-3-pro-image", "2K", {
      total_input_tokens: 1000,
      total_output_tokens: 1120,
      total_thought_tokens: 0,
    });
    expect(cost.imageCostSource).toBe("table");
    expect(cost.totalCost).toBeCloseTo((1000 / 1e6) * 2 + 0.134, 8);
  });

  it("charges no image when none came back but still bills input and thinking", () => {
    const cost = createImageGenerationCost(
      "gemini-3-pro-image",
      "1K",
      { total_input_tokens: 3000, total_output_tokens: 0, total_thought_tokens: 500 },
      0,
      { imageReturned: false }
    );
    expect(cost.imageCostSource).toBe("none");
    expect(cost.totalCost).toBeCloseTo((3000 / 1e6) * 2 + (500 / 1e6) * 12, 8);
  });

  it("adds grounding queries", () => {
    const cost = createImageGenerationCost("gemini-3.1-flash-image", "1K", usage(0, 1120), 2);
    expect(cost.searchCost).toBeCloseTo(0.028, 8);
    expect(cost.totalCost).toBeCloseTo(0.0672 + 0.028, 8);
  });

  it("sums several calls of one row into a single total", () => {
    const a = createImageGenerationCost("gemini-3.1-flash-image", "1K", usage(2000, 1120));
    const b = createImageGenerationCost("gemini-3.1-flash-image", "1K", usage(2000, 1120));
    expect(sumCosts([a, b]).totalCost).toBeCloseTo(a.totalCost * 2, 10);
  });
});

describe("readImageOutputTokens", () => {
  it("reads only the image modality, case-insensitively", () => {
    expect(
      readImageOutputTokens({
        output_tokens_by_modality: [
          { modality: "TEXT", tokens: 40 },
          { modality: "IMAGE", tokens: 1120 },
        ],
      })
    ).toBe(1120);
    expect(readImageOutputTokens(null)).toBe(0);
    expect(readImageOutputTokens({})).toBe(0);
  });
});
