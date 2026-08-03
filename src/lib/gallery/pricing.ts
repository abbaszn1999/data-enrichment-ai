import {
  costToCredits,
  calculateGroundedCallCost,
  getImageOutputCost,
} from "@/lib/ai-pricing";
import { GALLERY_SCRAPING_MODEL } from "@/lib/gallery/providers/openai-scraping";
import type {
  GalleryAiSettings,
  GalleryProvider,
  GallerySearchDepth,
} from "@/lib/gallery/types";

const SCRAPE_ESTIMATE_INPUT_TOKENS = 12_000;
const SCRAPE_ESTIMATE_OUTPUT_TOKENS = 800;

export function shouldChargeGalleryCredits(credits: number): boolean {
  return Number.isFinite(credits) && credits > 0;
}

export type GalleryCreditEstimateRange = {
  min: number;
  max: number;
  expectedQueriesPerStage: number;
  highQueriesPerStage: number;
};

export function estimateScrapingCreditRange(options: {
  rowCount: number;
  searchDepth?: GallerySearchDepth;
  rowsWithOriginal?: number;
  observedMedianQueries?: number;
  observedP90Queries?: number;
}): GalleryCreditEstimateRange {
  const rowCount = Math.max(0, options.rowCount);
  if (rowCount === 0) {
    return { min: 0, max: 0, expectedQueriesPerStage: 0, highQueriesPerStage: 0 };
  }
  // Rows without an original image use separate Main and Gallery search agents.
  // Rows with a trusted original need only the Gallery search agent.
  const rowsWithOriginal = Math.min(
    rowCount,
    Math.max(0, options.rowsWithOriginal ?? 0)
  );
  const stages = rowCount * 2 - rowsWithOriginal;
  const configured = 1;
  const expectedQueriesPerStage = Math.max(
    1,
    Math.round(options.observedMedianQueries || configured)
  );
  const highQueriesPerStage = Math.max(
    expectedQueriesPerStage,
    Math.ceil(options.observedP90Queries || configured * 2)
  );
  const usage = (factor: number) => ({
    promptTokenCount: Math.round(SCRAPE_ESTIMATE_INPUT_TOKENS * stages * factor),
    candidatesTokenCount: Math.round(
      SCRAPE_ESTIMATE_OUTPUT_TOKENS * stages * factor
    ),
    totalTokenCount: Math.round(
      (SCRAPE_ESTIMATE_INPUT_TOKENS + SCRAPE_ESTIMATE_OUTPUT_TOKENS) *
        stages *
        factor
    ),
  });
  const minimum = costToCredits(
    calculateGroundedCallCost(
      GALLERY_SCRAPING_MODEL,
      usage(0.75),
      expectedQueriesPerStage * stages
    ).totalCost
  );
  const maximum = costToCredits(
    calculateGroundedCallCost(
      GALLERY_SCRAPING_MODEL,
      usage(1.5),
      highQueriesPerStage * stages
    ).totalCost
  );
  return {
    min: Math.round(minimum * 1000) / 1000,
    max: Math.round(maximum * 1000) / 1000,
    expectedQueriesPerStage,
    highQueriesPerStage,
  };
}

/**
 * Conservative preflight for Scraping path:
 * Separate Main and Gallery requests when Main must be sourced.
 */
export function estimateScrapingCredits(
  rowCount: number,
  searchDepth: GallerySearchDepth = "medium",
  rowsWithOriginal = 0
): number {
  return estimateScrapingCreditRange({
    rowCount,
    searchDepth,
    rowsWithOriginal,
  }).max;
}

/** @deprecated Use estimateScrapingCredits */
export function estimateGoogleCredits(rowCount: number): number {
  return estimateScrapingCredits(rowCount, "medium");
}

export function estimateGalleryCredits(
  provider: GalleryProvider,
  rowCount: number,
  aiSettings?: GalleryAiSettings,
  options?: {
    generateMainPerRow?: boolean;
    searchDepth?: GallerySearchDepth;
    rowsWithOriginal?: number;
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
    const mainImages = options?.generateMainPerRow
      ? Math.min(Math.max(settings?.main?.imagesPerRow || 1, 1), 6)
      : 0;
    const imagesPerRow = galleryImages + mainImages;
    const imageOutput =
      getImageOutputCost(model, resolution) * imagesPerRow * rowCount;
    const perCallOverhead =
      (model === "gemini-3-pro-image" ? 0.012 : 0.004) +
      (settings?.groundWithSearch ? 0.014 : 0);
    return (
      Math.ceil(
        costToCredits(imageOutput + perCallOverhead * imagesPerRow * rowCount) *
          1.1 *
          1000
      ) / 1000
    );
  }

  return estimateScrapingCredits(
    rowCount,
    options?.searchDepth || "medium",
    options?.rowsWithOriginal ?? 0
  );
}
