import {
  costToCredits,
  calculateOpenAiWebSearchCost,
  getImageOutputCost,
  getModelPricing,
} from "@/lib/ai-pricing";
import { resolveGalleryPlannerModel } from "@/lib/gallery/agents/planner-model";
import { GALLERY_SCRAPING_OPENAI_MODEL } from "@/lib/enrich/models";
import type {
  GalleryAiSettings,
  GalleryProvider,
  GallerySearchDepth,
  GalleryScrapingSettings,
} from "@/lib/gallery/types";

export function shouldChargeGalleryCredits(credits: number): boolean {
  return Number.isFinite(credits) && credits > 0;
}

export type GalleryCreditEstimateRange = {
  min: number;
  max: number;
  /** Research rounds assumed per row for the expected and the high case. */
  expectedRounds: number;
  highRounds: number;
};

/**
 * One gallery-research row is a multi-round GPT-6.1 Sol loop. Each round
 * re-reads the growing conversation (mostly served from the prompt cache)
 * and adds fresh tool output. Modeled per round, then priced with the same
 * per-request calculator the real charge uses, so long-context tiers and
 * cached rates match.
 */
export type GalleryResearchProfile = { rounds: number; searches: number };

export const GALLERY_ESTIMATE_PROFILES: Record<
  GallerySearchDepth,
  { expected: GalleryResearchProfile; high: GalleryResearchProfile }
> = {
  low: { expected: { rounds: 5, searches: 2 }, high: { rounds: 10, searches: 3 } },
  medium: { expected: { rounds: 8, searches: 3 }, high: { rounds: 16, searches: 5 } },
  high: { expected: { rounds: 12, searches: 4 }, high: { rounds: 22, searches: 8 } },
};

/** Skill + brief + attached input images on the first round. */
const ESTIMATE_BASE_INPUT_TOKENS = 9_000;
/** Fresh tool output added to the conversation per round. */
const ESTIMATE_STEP_INPUT_TOKENS = 4_500;
/** Share of the previous context served from the prompt cache. */
const ESTIMATE_CACHE_SHARE = 0.9;
const ESTIMATE_ROUND_OUTPUT_TOKENS = 900;
const ESTIMATE_FINAL_OUTPUT_TOKENS = 1_500;

export function estimateGalleryResearchRowCost(profile: GalleryResearchProfile): number {
  let total = 0;
  for (let round = 1; round <= profile.rounds; round += 1) {
    const context = ESTIMATE_BASE_INPUT_TOKENS + (round - 1) * ESTIMATE_STEP_INPUT_TOKENS;
    const previous = round === 1 ? 0 : context - ESTIMATE_STEP_INPUT_TOKENS;
    const cached = Math.round(previous * ESTIMATE_CACHE_SHARE);
    const output = round === profile.rounds ? ESTIMATE_FINAL_OUTPUT_TOKENS : ESTIMATE_ROUND_OUTPUT_TOKENS;
    total += calculateOpenAiWebSearchCost(
      GALLERY_SCRAPING_OPENAI_MODEL,
      {
        input_tokens: context,
        input_tokens_details: { cached_tokens: cached },
        output_tokens: output,
      },
      round <= profile.searches ? 1 : 0
    ).totalCost;
  }
  return total;
}

export function estimateScrapingCreditRange(options: {
  rowCount: number;
  searchDepth?: GallerySearchDepth;
  /** @deprecated Scraping is one stage per row; kept so older callers compile. */
  rowsWithOriginal?: number;
  /** @deprecated Scraping has no tiers. */
  tier?: GalleryScrapingSettings["tier"];
}): GalleryCreditEstimateRange {
  const rowCount = Math.max(0, options.rowCount);
  const profile = GALLERY_ESTIMATE_PROFILES[options.searchDepth ?? "high"] ?? GALLERY_ESTIMATE_PROFILES.high;
  if (rowCount === 0) {
    return { min: 0, max: 0, expectedRounds: profile.expected.rounds, highRounds: profile.high.rounds };
  }
  const minimum = costToCredits(estimateGalleryResearchRowCost(profile.expected) * rowCount);
  const maximum = costToCredits(estimateGalleryResearchRowCost(profile.high) * rowCount);
  return {
    min: Math.round(minimum * 1000) / 1000,
    max: Math.round(maximum * 1000) / 1000,
    expectedRounds: profile.expected.rounds,
    highRounds: profile.high.rounds,
  };
}

/** Preflight for the Scraping path: the high-case estimate. */
export function estimateScrapingCredits(
  rowCount: number,
  searchDepth: GallerySearchDepth = "high"
): number {
  return estimateScrapingCreditRange({ rowCount, searchDepth }).max;
}

const PLANNER_ESTIMATE_INPUT_TOKENS = 4_500;
const PLANNER_ESTIMATE_OUTPUT_TOKENS = 1_800;

export function estimatePlannerCredits(options: {
  rowCount: number;
  tier?: GalleryAiSettings["tier"];
}): number {
  const rowCount = Math.max(0, options.rowCount);
  if (rowCount === 0) return 0;
  const model = resolveGalleryPlannerModel(options.tier);
  const pricing = getModelPricing(model);
  const perRow =
    (PLANNER_ESTIMATE_INPUT_TOKENS / 1_000_000) * pricing.inputPerMillion +
    (PLANNER_ESTIMATE_OUTPUT_TOKENS / 1_000_000) * pricing.outputPerMillion;
  return Math.round(costToCredits(perRow * rowCount * 1.4) * 1000) / 1000;
}

export function estimateGalleryCredits(
  provider: GalleryProvider,
  rowCount: number,
  aiSettings?: GalleryAiSettings,
  options?: {
    generateMainPerRow?: boolean;
    generateMainCount?: number;
    searchDepth?: GallerySearchDepth;
    tier?: GalleryScrapingSettings["tier"];
  }
): number {
  if (provider === "ai") {
    if (rowCount <= 0) return 0;
    const settings = aiSettings;
    const model =
      settings?.tier === "premium"
        ? "gemini-3-pro-image"
        : "gemini-3.1-flash-image";
    const resolution = settings?.resolution || "1K";
    const galleryImages = Math.min(
      Math.max(settings?.imagesPerRow || 4, 1),
      8
    );
    const mainImages =
      typeof options?.generateMainCount === "number"
        ? Math.max(0, options.generateMainCount)
        : options?.generateMainPerRow
          ? rowCount
          : 0;
    const imageOutput =
      getImageOutputCost(model, resolution) *
      (galleryImages * rowCount + mainImages);
    const imageCalls = galleryImages * rowCount + mainImages;
    const perCallOverhead =
      (model === "gemini-3-pro-image" ? 0.012 : 0.004) +
      (settings?.groundWithSearch ? 0.014 : 0);
    const imageCredits =
      Math.ceil(
        costToCredits(imageOutput + perCallOverhead * imageCalls) * 1.1 * 1000
      ) / 1000;
    const plannerCredits = estimatePlannerCredits({
      rowCount,
      tier: settings?.tier,
    });
    return Math.round((imageCredits + plannerCredits) * 1000) / 1000;
  }

  return estimateScrapingCredits(rowCount, options?.searchDepth || "high");
}
