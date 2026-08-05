import { costToCredits, getImageOutputCost, getModelPricing } from "@/lib/ai-pricing";
import {
  resolveVisualizerDescriptionModel,
  resolveVisualizerImageModel,
  type VisualizerImagesSettings,
  type VisualizerTier,
} from "@/lib/visualizer/types";

const ESTIMATE_INPUT_TOKENS = 4_500;
const ESTIMATE_OUTPUT_TOKENS = 1_800;

export function estimateDescriptionCredits(params: {
  rowCount: number;
  tier?: VisualizerTier;
}): { min: number; max: number } {
  const rowCount = Math.max(0, params.rowCount);
  if (rowCount === 0) return { min: 0, max: 0 };
  const model = resolveVisualizerDescriptionModel(params.tier);
  const pricing = getModelPricing(model);
  const perRow =
    (ESTIMATE_INPUT_TOKENS / 1_000_000) * pricing.inputPerMillion +
    (ESTIMATE_OUTPUT_TOKENS / 1_000_000) * pricing.outputPerMillion;
  const min = costToCredits(perRow * rowCount * 0.75);
  const max = costToCredits(perRow * rowCount * 1.4);
  return {
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
  };
}

export function estimateImageCredits(params: {
  placeholderCount: number;
  images?: Pick<VisualizerImagesSettings, "tier" | "resolution">;
}): { min: number; max: number } {
  const placeholderCount = Math.max(0, params.placeholderCount);
  if (placeholderCount === 0) return { min: 0, max: 0 };
  // Image generation is always Nano Banana Pro at 1K.
  const model = resolveVisualizerImageModel("premium");
  const resolution = "1K";
  void params.images;
  const perImage =
    getImageOutputCost(model, resolution) +
    (model === "gemini-3-pro-image" ? 0.012 : 0.004);
  const min = costToCredits(perImage * placeholderCount * 0.95);
  const max = costToCredits(perImage * placeholderCount * 1.2);
  return {
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
  };
}

export function shouldChargeVisualizerCredits(credits: number): boolean {
  return Number.isFinite(credits) && credits > 0;
}
