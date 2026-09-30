import { sumCosts, type AiCallCost } from "@/lib/ai-pricing";

function tokenTotals(costs: AiCallCost[]) {
  return {
    input: costs.reduce((sum, cost) => sum + cost.usage.promptTokens, 0),
    cached: costs.reduce((sum, cost) => sum + cost.usage.cachedTokens, 0),
    output: costs.reduce((sum, cost) => sum + cost.usage.candidatesTokens, 0),
    reasoning: costs.reduce((sum, cost) => sum + cost.usage.thoughtsTokens, 0),
  };
}

export interface AiRowBillingInput {
  plannerCosts: AiCallCost[];
  /** One entry per billed image call, in call order, including failed calls with usage. */
  imageCosts: AiCallCost[];
  plannerModel: string;
  imageModel: string;
  resolution: string;
  aspectRatio: string;
  outputFormat: string;
  requestedImages: number;
  generatedImages: number;
  failedImages: number;
  plannerReused: boolean;
  references: Record<string, number>;
}

/**
 * One row, one charge: every billed OpenAI planner round plus every billed
 * Nano Banana call, summed in dollars and converted to credits once.
 */
export function buildAiRowCharge(input: AiRowBillingInput) {
  const all = [...input.plannerCosts, ...input.imageCosts];
  const totals = sumCosts(all);
  const planner = sumCosts(input.plannerCosts);
  const images = sumCosts(input.imageCosts);
  return {
    totals,
    details: {
      provider: "ai",
      pipeline: "gallery-generate",
      plannerModel: input.plannerModel,
      plannerRounds: input.plannerCosts.length,
      plannerReused: input.plannerReused,
      plannerTokens: tokenTotals(input.plannerCosts),
      plannerCost: planner.totalCost,
      model: input.imageModel,
      imageCalls: input.imageCosts.length,
      imageTokens: tokenTotals(input.imageCosts),
      imageOutputTokens: input.imageCosts.reduce((sum, cost) => sum + (cost.imageOutputTokens ?? 0), 0),
      imageCostSources: [...new Set(input.imageCosts.map((cost) => cost.imageCostSource ?? "none"))],
      imageCost: images.totalCost,
      perImage: input.imageCosts.map((cost) => ({
        cost: cost.totalCost,
        imageTokens: cost.imageOutputTokens ?? 0,
        source: cost.imageCostSource ?? "none",
      })),
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      outputFormat: input.outputFormat,
      requestedImages: input.requestedImages,
      generatedImages: input.generatedImages,
      failedImages: input.failedImages,
      references: input.references,
      dollarCost: totals.totalCost,
    } as Record<string, unknown>,
  };
}
