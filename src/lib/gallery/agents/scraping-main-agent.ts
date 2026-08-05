import type { AiCallCost } from "@/lib/ai-pricing";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";
import { galleryLog } from "@/lib/gallery/log";
import {
  buildFocusedRow,
  candidatePoolSize,
  runOpenAiWebImageSearch,
  selectedCandidates,
  type OpenAiImageCandidate,
  resolveScrapingModel,
} from "@/lib/gallery/agents/scraping-shared";

/** JSON schema for the Scraping Main agent only — no Gallery fields. */
export const SCRAPING_MAIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    productIdentity: { type: "string" },
    mainImageUrls: {
      type: "array",
      items: { type: "string" },
    },
    notes: { type: "string" },
  },
  required: ["productIdentity", "mainImageUrls", "notes"],
} as const;

export type ScrapingMainSearchResult = {
  productIdentity: string;
  mainCandidates: OpenAiImageCandidate[];
  allImageResults: OpenAiImageCandidate[];
  cost: AiCallCost;
  searchCallCount: number;
  notes?: string;
};

export function buildScrapingMainPrompt(params: {
  focusedRow: Record<string, string>;
  mainCount: number;
  mainInstructions?: string;
}): string {
  const mainCustom = params.mainInstructions?.trim() || "";
  return [
    "Find Main product images for the EXACT product described below.",
    `Select exactly ${params.mainCount} Main images when reliable matches exist.`,
    "Main images are clear primary product shots that establish the exact product (catalog / hero style).",
    params.mainCount > 1
      ? `When returning ${params.mainCount} Main images, each URL must show a professionally distinct view of the SAME product (different angle, crop, or lighting). Never return duplicates or near-identical frames.`
      : "",
    "Accept any resolution and any aspect ratio — do not reject images for size or shape.",
    "Exact product match is mandatory: same model, color, variant, and packaging.",
    "Reject wrong products, similar models, wrong colors, and wrong variants.",
    "Do not invent or alter URLs. Only return image URLs that exist verbatim in the image-search results.",
    "When image-search results include clear exact matches, select the best ones — do not return an empty list out of caution.",
    "Return an empty mainImageUrls list only when image-search results contain no plausible exact-product matches.",
    "If fewer than the requested count are reliable, return the reliable subset rather than inventing or forcing weak matches.",
    mainCustom
      ? `MAIN IMAGE CUSTOM INSTRUCTIONS — treat as mandatory unless unsafe:\n${mainCustom}`
      : "",
    `Product data:\n${JSON.stringify(params.focusedRow, null, 2)}`,
    "Respond with JSON only using: productIdentity, mainImageUrls, notes.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildScrapingMainSchema(mainCount: number) {
  return {
    ...SCRAPING_MAIN_SCHEMA,
    properties: {
      ...SCRAPING_MAIN_SCHEMA.properties,
      mainImageUrls: {
        type: "array",
        items: { type: "string" },
        maxItems: Math.max(1, mainCount),
      },
    },
  };
}

/**
 * Scraping Main agent: finds primary product images only.
 * Settings used: main.imagesPerRow, main.instructions only.
 * Gallery filters (depth, source, resolution, aspect) are intentionally ignored.
 */
export async function searchScrapingMainImages(params: {
  rowData: Record<string, string>;
  selectedColumns: string[];
  settings: GalleryScrapingSettings;
}): Promise<ScrapingMainSearchResult> {
  const mainCount = Math.min(
    6,
    Math.max(1, params.settings.main?.imagesPerRow || 1)
  );
  const focusedRow = buildFocusedRow(params.rowData, params.selectedColumns);
  const prompt = buildScrapingMainPrompt({
    focusedRow,
    mainCount,
    mainInstructions: params.settings.main?.instructions,
  });
  // Fixed medium depth — Candidate depth UI setting is Gallery-only.
  const mainSearchSettings = {
    ...params.settings,
    searchDepth: "medium" as const,
  };
  const maxResults = candidatePoolSize(mainSearchSettings, mainCount);

  const { selection, allImageResults, cost, searchCallCount } =
    await runOpenAiWebImageSearch({
      agent: "scraping-main",
      prompt,
      schemaName: "product_main_selection",
      schema: buildScrapingMainSchema(mainCount),
      maxResults,
      searchDepth: "medium",
      model: resolveScrapingModel(params.settings.tier),
      tier: params.settings.tier,
    });

  const selectedMainCandidates = selectedCandidates(
    selection?.mainImageUrls,
    mainCount
  );

  galleryLog("scraping-main:done", "Scraping Main agent completed", {
    productIdentity: selection?.productIdentity || "",
    imageResultCount: allImageResults.length,
    mainCandidateCount: selectedMainCandidates.length,
    selectedMainUrlCount: Array.isArray(selection?.mainImageUrls)
      ? selection.mainImageUrls.length
      : 0,
    searchCallCount,
    notes: selection?.notes ? String(selection.notes).slice(0, 400) : null,
  });

  return {
    productIdentity: String(selection?.productIdentity || "").trim(),
    mainCandidates: selectedMainCandidates,
    allImageResults,
    cost,
    searchCallCount,
    notes: selection?.notes ? String(selection.notes) : undefined,
  };
}
