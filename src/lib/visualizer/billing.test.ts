import { describe, expect, it } from "vitest";
import { createImageGenerationCost } from "@/lib/ai-pricing";
import { buildDescriptionCharge, buildImagesCharge } from "./billing";
import { estimateDescriptionCredits, estimateImageCredits } from "./pricing";

const usage = {
  total_input_tokens: 2000,
  total_output_tokens: 1320,
  total_thought_tokens: 200,
  output_tokens_by_modality: [{ modality: "image", tokens: 1120 }],
};

function imageCost(model: "gemini-3.1-flash-image" | "gemini-3-pro-image" = "gemini-3.1-flash-image") {
  return createImageGenerationCost(model, "1K", usage, 0, { imageReturned: true });
}

describe("buildImagesCharge", () => {
  it("sums every billed call once and keys the charge by the generated slots", () => {
    const costs = [imageCost(), imageCost(), imageCost()];
    const charge = buildImagesCharge({
      imageCosts: costs,
      imageModel: "gemini-3.1-flash-image",
      tier: "standard",
      resolution: "1K",
      aspectRatio: "1:1",
      outputFormat: "image/jpeg",
      requestedImages: 3,
      generatedIndexes: [3, 1],
      failedImages: 1,
      references: { product: 2, logo: 1 },
    });
    const expected = costs.reduce((sum, cost) => sum + cost.totalCost, 0);
    expect(charge.totals.totalCost).toBeCloseTo(expected, 10);
    expect(charge.indexKey).toBe("1-3");
    expect(charge.details).toMatchObject({
      pipeline: "visualizer-images",
      model: "gemini-3.1-flash-image",
      tier: "standard",
      imageCalls: 3,
      requestedImages: 3,
      generatedImages: 2,
      generatedIndexes: [1, 3],
      failedImages: 1,
      references: { product: 2, logo: 1 },
    });
    expect((charge.details.perImage as unknown[]).length).toBe(3);
  });

  it("charges a failed call that still reported usage", () => {
    const failed = createImageGenerationCost("gemini-3-pro-image", "1K", usage, 0, { imageReturned: false });
    const charge = buildImagesCharge({
      imageCosts: [imageCost("gemini-3-pro-image"), failed],
      imageModel: "gemini-3-pro-image",
      tier: "premium",
      resolution: "1K",
      aspectRatio: "1:1",
      outputFormat: "image/jpeg",
      requestedImages: 2,
      generatedIndexes: [1],
      failedImages: 1,
      references: {},
    });
    expect(charge.totals.totalCost).toBeGreaterThan(imageCost("gemini-3-pro-image").totalCost);
  });
});

describe("buildDescriptionCharge", () => {
  it("records the planner model, rounds and references", () => {
    const charge = buildDescriptionCharge({
      plannerCosts: [imageCost()],
      plannerModel: "gpt-6.1-sol",
      imageModel: "gemini-3-pro-image",
      tier: "premium",
      layoutId: "zigzag",
      requestedImages: 4,
      references: { product: 3 },
    });
    expect(charge.details).toMatchObject({
      pipeline: "visualizer-description",
      plannerModel: "gpt-6.1-sol",
      plannerRounds: 1,
      tier: "premium",
      layoutId: "zigzag",
      requestedImages: 4,
    });
    expect(charge.totals.totalCredits).toBeGreaterThan(0);
  });
});

describe("estimates", () => {
  it("prices Premium images above Standard images", () => {
    const standard = estimateImageCredits({ placeholderCount: 4, images: { tier: "standard", resolution: "1K", groundWithSearch: false } });
    const premium = estimateImageCredits({ placeholderCount: 4, images: { tier: "premium", resolution: "1K", groundWithSearch: false } });
    expect(premium.max).toBeGreaterThan(standard.max);
    expect(standard.min).toBeLessThan(standard.max);
  });

  it("estimates zero for no slots or no rows", () => {
    expect(estimateImageCredits({ placeholderCount: 0 })).toEqual({ min: 0, max: 0 });
    expect(estimateDescriptionCredits({ rowCount: 0 })).toEqual({ min: 0, max: 0 });
  });

  it("scales the planner estimate with rows and image count", () => {
    const one = estimateDescriptionCredits({ rowCount: 1, imageCount: 2 });
    const many = estimateDescriptionCredits({ rowCount: 10, imageCount: 6 });
    expect(many.max).toBeGreaterThan(one.max * 10);
  });
});
