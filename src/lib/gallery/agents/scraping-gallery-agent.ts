import type { AiCallCost } from "@/lib/ai-pricing";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";
import { galleryLog } from "@/lib/gallery/log";
import {
  buildFocusedRow,
  candidatePoolSize,
  runOpenAiWebImageSearch,
  selectedCandidates,
  sourcePolicyInstruction,
  type OpenAiImageCandidate,
  type ScrapingMainImageAttachment,
  resolveScrapingModel,
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
  mainImageUrls?: string[];
}): string {
  const galleryCustom = params.settings.instructions.trim();
  const mainUrls = (params.mainImageUrls || [])
    .map((url) => String(url || "").trim())
    .filter(Boolean);
  const mainCount = mainUrls.length;
  return [
    "Find Gallery images for the EXACT product described below.",
    mainCount > 1
      ? `The ${mainCount} attached images are the trusted Main images for this product. Find Gallery images only for this exact product.`
      : "The attached image is the trusted Main image. Find Gallery images only for this exact product.",
    `Return ${params.galleryCount} Gallery images when reliable matches exist.`,
    "Use image search. Visually compare the results and reject similar products, wrong variants, wrong colors, and wrong packaging.",
    mainCount > 1
      ? "Gallery images must be meaningfully different from EVERY attached Main image and from one another: alternate angle, back, side, packaging, detail, or lifestyle."
      : "Gallery images must be meaningfully different from Main and from one another: alternate angle, back, side, packaging, detail, or lifestyle.",
    "Reject resized copies, near-duplicate crops, and repeated compositions.",
    params.settings.minResolution > 0
      ? `Prefer Gallery images at least ${params.settings.minResolution}px on their shortest side.`
      : "",
    params.settings.aspectRatio !== "any"
      ? `Prefer ${params.settings.aspectRatio} Gallery images.`
      : "",
    "Only return image URLs that exist verbatim in the image-search results. Never invent or alter a URL.",
    "When image-search results include clear exact matches that differ from Main, select them — do not return an empty Gallery out of caution.",
    "Omit only clearly wrong products, wrong variants, or near-duplicates of Main. Return an empty galleryImageUrls list only when no plausible exact Gallery matches exist in the results.",
    "If fewer than the requested count are reliable, return the reliable subset.",
    sourcePolicyInstruction(params.settings),
    galleryCustom
      ? `GALLERY CUSTOM INSTRUCTIONS — treat as mandatory unless unsafe:\n${galleryCustom}`
      : "",
    `Product data:\n${JSON.stringify(params.focusedRow, null, 2)}`,
    mainUrls.length > 0
      ? `Do not return any of these Main URLs in Gallery:\n${mainUrls.map((url) => `- ${url}`).join("\n")}`
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
 * Scraping Gallery agent: finds diversified Gallery images using trusted Main
 * image(s). Settings used: imagesPerRow, instructions, searchDepth, sourcePolicy,
 * minResolution, aspectRatio.
 */
export async function searchScrapingGalleryImages(params: {
  rowData: Record<string, string>;
  selectedColumns: string[];
  settings: GalleryScrapingSettings;
  requestedGalleryImages: number;
  /** Preferred: all Main images for this product. */
  mainImages?: ScrapingMainImageAttachment[];
  /** @deprecated Prefer `mainImages`. */
  mainImage?: ScrapingMainImageAttachment;
}): Promise<ScrapingGallerySearchResult> {
  const galleryCount = Math.max(1, params.requestedGalleryImages);
  const mainImages =
    params.mainImages && params.mainImages.length > 0
      ? params.mainImages
      : params.mainImage
        ? [params.mainImage]
        : [];
  if (mainImages.length === 0) {
    throw new Error("At least one Main image is required for gallery search");
  }

  const focusedRow = buildFocusedRow(params.rowData, params.selectedColumns);
  const mainImageUrls = mainImages.map((image) => image.url).filter(Boolean);
  const prompt = buildScrapingGalleryPrompt({
    focusedRow,
    galleryCount,
    settings: params.settings,
    mainImageUrls,
  });
  const maxResults = candidatePoolSize(params.settings, galleryCount);

  const { selection, allImageResults, cost, searchCallCount } =
    await runOpenAiWebImageSearch({
      agent: "scraping-gallery",
      prompt,
      schemaName: "product_gallery_selection",
      schema: buildScrapingGallerySchema(galleryCount),
      maxResults,
      searchDepth: params.settings.searchDepth,
      mainImages,
      model: resolveScrapingModel(params.settings.tier),
      tier: params.settings.tier,
    });

  const blockedMainUrls = new Set(
    mainImageUrls.map((url) => url.trim().toLowerCase()).filter(Boolean)
  );
  const selectedGalleryCandidates = selectedCandidates(
    selection?.galleryImageUrls,
    galleryCount
  ).filter((candidate) => !blockedMainUrls.has(candidate.imageUrl.toLowerCase()));

  galleryLog("scraping-gallery:done", "Scraping Gallery agent completed", {
    productIdentity: selection?.productIdentity || "",
    imageResultCount: allImageResults.length,
    galleryCandidateCount: selectedGalleryCandidates.length,
    selectedGalleryUrlCount: Array.isArray(selection?.galleryImageUrls)
      ? selection.galleryImageUrls.length
      : 0,
    mainAttachmentCount: mainImages.length,
    searchCallCount,
    notes: selection?.notes ? String(selection.notes).slice(0, 400) : null,
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
