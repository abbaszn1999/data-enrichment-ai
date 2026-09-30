import { costToCredits, getImageOutputCost, getModelPricing } from "@/lib/ai-pricing";
import {
  resolveVisualizerDescriptionModel,
  resolveVisualizerImageModel,
  type VisualizerImagesSettings,
  type VisualizerTier,
} from "@/lib/visualizer/types";

/** Skill + brief + row text, plus about three reference images at roughly 1,200 tokens each. */
const PLANNER_ESTIMATE_INPUT_TOKENS = 8_000;
/** Medium reasoning plus about 1,500 tokens of page HTML. */
const PLANNER_ESTIMATE_BASE_OUTPUT_TOKENS = 4_000;
/** About 300 tokens of prompt per image slot. */
const PLANNER_ESTIMATE_OUTPUT_TOKENS_PER_IMAGE = 300;

/** Planner cost range for the description phase (one GPT-6.1 Sol call per row). */
export function estimateDescriptionCredits(params: {
  rowCount: number;
  tier?: VisualizerTier;
  imageCount?: number;
}): { min: number; max: number } {
  const rowCount = Math.max(0, params.rowCount);
  if (rowCount === 0) return { min: 0, max: 0 };
  const imageCount = Math.min(6, Math.max(1, Math.floor(params.imageCount ?? 4) || 4));
  const pricing = getModelPricing(resolveVisualizerDescriptionModel(params.tier));
  const perRow =
    (PLANNER_ESTIMATE_INPUT_TOKENS / 1_000_000) * pricing.inputPerMillion +
    ((PLANNER_ESTIMATE_BASE_OUTPUT_TOKENS + PLANNER_ESTIMATE_OUTPUT_TOKENS_PER_IMAGE * imageCount) / 1_000_000) *
      pricing.outputPerMillion;
  const min = costToCredits(perRow * rowCount * 0.75);
  const max = costToCredits(perRow * rowCount * 1.4);
  return {
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
  };
}

/** Nano Banana cost range for the images still to be generated, on the tier's model. */
export function estimateImageCredits(params: {
  placeholderCount: number;
  images?: Pick<VisualizerImagesSettings, "tier" | "resolution" | "groundWithSearch">;
}): { min: number; max: number } {
  const placeholderCount = Math.max(0, params.placeholderCount);
  if (placeholderCount === 0) return { min: 0, max: 0 };
  const model = resolveVisualizerImageModel(params.images?.tier);
  const resolution = params.images?.resolution || "1K";
  // Per call: prompt and reference-image input tokens plus thinking tokens.
  const overhead =
    (model === "gemini-3-pro-image" ? 0.024 : 0.006) + (params.images?.groundWithSearch ? 0.014 : 0);
  const perImage = getImageOutputCost(model, resolution) + overhead;
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
