import { sumCosts, type AiCallCost } from "@/lib/ai-pricing";

function tokenTotals(costs: AiCallCost[]) {
  return {
    input: costs.reduce((sum, cost) => sum + cost.usage.promptTokens, 0),
    cached: costs.reduce((sum, cost) => sum + cost.usage.cachedTokens, 0),
    output: costs.reduce((sum, cost) => sum + cost.usage.candidatesTokens, 0),
    reasoning: costs.reduce((sum, cost) => sum + cost.usage.thoughtsTokens, 0),
  };
}

export interface VisualizerDescriptionBillingInput {
  plannerCosts: AiCallCost[];
  plannerModel: string;
  imageModel: string;
  tier: string;
  layoutId: string;
  requestedImages: number;
  references: Record<string, number>;
}

/** One row, one description charge: every billed planner round, converted to credits once. */
export function buildDescriptionCharge(input: VisualizerDescriptionBillingInput) {
  const totals = sumCosts(input.plannerCosts);
  return {
    totals,
    details: {
      pipeline: "visualizer-description",
      plannerModel: input.plannerModel,
      plannerRounds: input.plannerCosts.length,
      plannerTokens: tokenTotals(input.plannerCosts),
      plannerCost: totals.totalCost,
      imageModel: input.imageModel,
      tier: input.tier,
      layoutId: input.layoutId,
      requestedImages: input.requestedImages,
      references: input.references,
      dollarCost: totals.totalCost,
    } as Record<string, unknown>,
  };
}

export interface VisualizerImagesBillingInput {
  /** One entry per billed image call, in call order, including failed calls with usage. */
  imageCosts: AiCallCost[];
  imageModel: string;
  tier: string;
  resolution: string;
  aspectRatio: string;
  outputFormat: string;
  requestedImages: number;
  generatedIndexes: number[];
  failedImages: number;
  references: Record<string, number>;
}

/** One row, one images charge: every billed Nano Banana call summed in dollars, converted once. */
export function buildImagesCharge(input: VisualizerImagesBillingInput) {
  const totals = sumCosts(input.imageCosts);
  const sortedIndexes = [...input.generatedIndexes].sort((a, b) => a - b);
  return {
    totals,
    /** Stable per generated set so a retried run never pays twice for the same images. */
    indexKey: sortedIndexes.join("-"),
    details: {
      pipeline: "visualizer-images",
      model: input.imageModel,
      tier: input.tier,
      imageCalls: input.imageCosts.length,
      imageTokens: tokenTotals(input.imageCosts),
      imageOutputTokens: input.imageCosts.reduce((sum, cost) => sum + (cost.imageOutputTokens ?? 0), 0),
      imageCostSources: [...new Set(input.imageCosts.map((cost) => cost.imageCostSource ?? "none"))],
      imageCost: totals.totalCost,
      perImage: input.imageCosts.map((cost) => ({
        cost: cost.totalCost,
        imageTokens: cost.imageOutputTokens ?? 0,
        source: cost.imageCostSource ?? "none",
      })),
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      outputFormat: input.outputFormat,
      requestedImages: input.requestedImages,
      generatedImages: sortedIndexes.length,
      generatedIndexes: sortedIndexes,
      failedImages: input.failedImages,
      references: input.references,
      dollarCost: totals.totalCost,
    } as Record<string, unknown>,
  };
}
