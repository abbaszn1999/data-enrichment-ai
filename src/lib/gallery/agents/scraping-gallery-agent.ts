import type { AiCallCost } from "@/lib/ai-pricing";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";
import { galleryLog, galleryWarn } from "@/lib/gallery/log";
import {
  buildFocusedRow,
  candidatePoolSize,
  runOpenAiWebImageSearch,
  selectedCandidates,
  sourcePolicyInstruction,
  urlKey,
  type OpenAiImageCandidate,
} from "@/lib/gallery/agents/scraping-shared";

/** JSON schema for the Scraping Gallery agent only — no Main selection fields. */
export const SCRAPING_GALLERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    productIdentity: { type: "string" },
    galleryImageUrls: {
      type: "array",
      items: { type: "string" },
    },
    notes: { type: "string" },
  },
  required: ["productIdentity", "galleryImageUrls", "notes"],
} as const;

export type ScrapingGallerySearchResult = {
  productIdentity: string;
  galleryCandidates: OpenAiImageCandidate[];
  allImageResults: OpenAiImageCandidate[];
  cost: AiCallCost;
  searchCallCount: number;
  notes?: string;
};

export function buildScrapingGalleryPrompt(params: {
  focusedRow: Record<string, string>;
  galleryCount: number;
  settings: GalleryScrapingSettings;
  mainImageUrl?: string;
}): string {
  const galleryCustom = params.settings.instructions.trim();
  return [
    "Find Gallery images for the EXACT product described below.",
    "The attached image is the trusted Main image. Find Gallery images only for this exact product.",
    `Return ${params.galleryCount} Gallery images when reliable matches exist.`,
    "Use image search. Visually compare the results and reject similar products, wrong variants, wrong colors, and wrong packaging.",
    "Gallery images must be meaningfully different from Main and from one another: alternate angle, back, side, packaging, detail, or lifestyle.",
    "Reject resized copies, near-duplicate crops, and repeated compositions.",
    params.settings.minResolution > 0
      ? `Prefer Gallery images at least ${params.settings.minResolution}px on their shortest side.`
      : "",
    params.settings.aspectRatio !== "any"
      ? `Prefer ${params.settings.aspectRatio} Gallery images.`
      : "",
    "Only return image URLs that exist verbatim in the image-search results. Never invent or alter a URL.",
    "If exact matching is uncertain, omit the image. An empty Gallery list is better than a wrong product.",
    sourcePolicyInstruction(params.settings),
    galleryCustom
      ? `GALLERY CUSTOM INSTRUCTIONS — treat as mandatory unless unsafe:\n${galleryCustom}`
      : "",
    `Product data:\n${JSON.stringify(params.focusedRow, null, 2)}`,
    params.mainImageUrl
      ? `Do not return this Main URL in Gallery: ${params.mainImageUrl}`
      : "",
    "Respond with JSON only using: productIdentity, galleryImageUrls, notes.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildScrapingGallerySchema(galleryCount: number) {
  return {
    ...SCRAPING_GALLERY_SCHEMA,
    properties: {
      ...SCRAPING_GALLERY_SCHEMA.properties,
      galleryImageUrls: {
        type: "array",
        items: { type: "string" },
        maxItems: Math.max(1, galleryCount),
      },
    },
  };
}

/**
 * Scraping Gallery agent: finds diversified Gallery images using a trusted Main.
 * Settings used: imagesPerRow, instructions, searchDepth, sourcePolicy,
 * minResolution, aspectRatio. (Exclude-marketplaces was removed.)
 */
export async function searchScrapingGalleryImages(params: {
  rowData: Record<string, string>;
  selectedColumns: string[];
  settings: GalleryScrapingSettings;
  requestedGalleryImages: number;
  mainImage: { buffer?: Buffer; contentType?: string; url: string };
}): Promise<ScrapingGallerySearchResult> {
  const galleryCount = Math.max(1, params.requestedGalleryImages);
  const focusedRow = buildFocusedRow(params.rowData, params.selectedColumns);
  const prompt = buildScrapingGalleryPrompt({
    focusedRow,
    galleryCount,
    settings: params.settings,
    mainImageUrl: params.mainImage.url,
  });
  const maxResults = candidatePoolSize(params.settings, galleryCount);

  const { selection, indexedImages, allImageResults, cost, searchCallCount } =
    await runOpenAiWebImageSearch({
      agent: "scraping-gallery",
      prompt,
      schemaName: "product_gallery_selection",
      schema: buildScrapingGallerySchema(galleryCount),
      maxResults,
      searchDepth: params.settings.searchDepth,
      mainImage: params.mainImage,
    });

  const blockedMainUrls = new Set(
    [params.mainImage.url].filter(Boolean).map((url) => urlKey(String(url)))
  );
  const selectedGalleryCandidates = selectedCandidates(
    selection?.galleryImageUrls,
    indexedImages.byUrl,
    galleryCount,
    allImageResults
  ).filter((candidate) => !blockedMainUrls.has(urlKey(candidate.imageUrl)));

  const selectedGalleryUrlCount = Array.isArray(selection?.galleryImageUrls)
    ? selection.galleryImageUrls.length
    : 0;
  if (selectedGalleryUrlCount > 0 && selectedGalleryCandidates.length === 0) {
    galleryWarn(
      "scraping-gallery",
      "Model-selected Gallery URLs did not match raw image-search results",
      {
        selectedGalleryUrlCount,
        matchedGalleryCount: selectedGalleryCandidates.length,
      }
    );
  }

  galleryLog("scraping-gallery:done", "Scraping Gallery agent completed", {
    productIdentity: selection?.productIdentity || "",
    imageResultCount: allImageResults.length,
    galleryCandidateCount: selectedGalleryCandidates.length,
    selectedGalleryUrlCount,
    searchCallCount,
  });

  return {
    productIdentity: String(selection?.productIdentity || "").trim(),
    galleryCandidates: selectedGalleryCandidates,
    allImageResults,
    cost,
    searchCallCount,
    notes: selection?.notes ? String(selection.notes) : undefined,
  };
}
