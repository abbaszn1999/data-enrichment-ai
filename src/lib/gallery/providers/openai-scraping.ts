/**
 * Compatibility re-exports for the Scraping OpenAI pipeline.
 * Prefer importing from the dedicated agents:
 * - `@/lib/gallery/agents/scraping-main-agent`
 * - `@/lib/gallery/agents/scraping-gallery-agent`
 */
export { GALLERY_SCRAPING_MODEL } from "@/lib/gallery/agents/scraping-shared";
export type { OpenAiImageCandidate } from "@/lib/gallery/agents/scraping-shared";
export {
  searchScrapingMainImages,
  type ScrapingMainSearchResult,
} from "@/lib/gallery/agents/scraping-main-agent";
export {
  searchScrapingGalleryImages,
  type ScrapingGallerySearchResult,
} from "@/lib/gallery/agents/scraping-gallery-agent";

import { searchScrapingMainImages } from "@/lib/gallery/agents/scraping-main-agent";
import { searchScrapingGalleryImages } from "@/lib/gallery/agents/scraping-gallery-agent";
import type { AiCallCost } from "@/lib/ai-pricing";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";
import type { OpenAiImageCandidate } from "@/lib/gallery/agents/scraping-shared";

/** @deprecated Use searchScrapingMainImages / searchScrapingGalleryImages. */
export type OpenAiGallerySearchResult = {
  productIdentity: string;
  mainCandidates: OpenAiImageCandidate[];
  galleryCandidates: OpenAiImageCandidate[];
  allImageResults: OpenAiImageCandidate[];
  cost: AiCallCost;
  searchCallCount: number;
  notes?: string;
};

/**
 * @deprecated Prefer the dedicated Main/Gallery agents.
 * Kept for older tests: routes by presence of mainImage / requestedGalleryImages.
 */
export async function searchOpenAiProductGallery(params: {
  rowData: Record<string, string>;
  selectedColumns: string[];
  settings: GalleryScrapingSettings;
  requestedGalleryImages: number;
  mainImage?: { buffer?: Buffer; contentType?: string; url: string };
}): Promise<OpenAiGallerySearchResult> {
  if (params.mainImage) {
    const gallery = await searchScrapingGalleryImages({
      rowData: params.rowData,
      selectedColumns: params.selectedColumns,
      settings: params.settings,
      requestedGalleryImages: params.requestedGalleryImages,
      mainImage: params.mainImage,
    });
    return {
      productIdentity: gallery.productIdentity,
      mainCandidates: [],
      galleryCandidates: gallery.galleryCandidates,
      allImageResults: gallery.allImageResults,
      cost: gallery.cost,
      searchCallCount: gallery.searchCallCount,
      notes: gallery.notes,
    };
  }

  const main = await searchScrapingMainImages({
    rowData: params.rowData,
    selectedColumns: params.selectedColumns,
    settings: params.settings,
  });
  return {
    productIdentity: main.productIdentity,
    mainCandidates: main.mainCandidates,
    galleryCandidates: [],
    allImageResults: main.allImageResults,
    cost: main.cost,
    searchCallCount: main.searchCallCount,
    notes: main.notes,
  };
}
