/**
 * Products Gallery scraping agent: one GPT-6.1 Sol (medium) research loop per
 * row. It reads the sheet's Main image(s) and known source pages, opens more
 * pages of the exact item with web_search + fetch_page + check_pages, looks at
 * candidates with view_images, and answers with N NEW gallery images. Code
 * re-checks the answer (gallery-guards.ts) and load-checks every image.
 */
import type { AiCallCost } from "@/lib/ai-pricing";
import {
  GALLERY_SCRAPING_OPENAI_MODEL,
  GALLERY_SCRAPING_REASONING_EFFORT,
} from "@/lib/enrich/models";
import { runEnrichOpenAiResponse, type EnrichResponseParser } from "@/lib/enrich/openai";
import type { EnrichToolPolicy } from "@/lib/enrich/policy";
import { EvidenceLedger, normalizeImageKey, normalizePageKey } from "@/lib/enrich/image-finder/evidence";
import { createCheckPagesTool } from "@/lib/enrich/image-finder/tools/check-pages";
import { createFetchPageTool, createPageSession } from "@/lib/enrich/image-finder/tools/fetch-page";
import { extractRowIdentifiers } from "@/lib/enrich/image-finder/tools/identifiers";
import { createViewImagesTool, loadImagePreview } from "@/lib/enrich/image-finder/tools/view-images";
import { keepLoadableImages, unverifiedImagesNote } from "@/lib/enrich/image-finder/verify-images";
import { galleryLog } from "@/lib/gallery/log";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";
import { buildGalleryBrief, classifyRowValues, textOnlyRow } from "./gallery-brief";
import {
  GALLERY_PERSPECTIVES,
  buildKnownImageKeys,
  guardGalleryAnswer,
  type GalleryAnswer,
  type GalleryPerspective,
  type KnownImageSize,
} from "./gallery-guards";
import { GALLERY_RESEARCH_SKILL } from "./gallery-research-skill";

export interface GalleryDepthBudget {
  /** Live page opens per product (fetch_page + check_pages). */
  pages: number;
  /** Candidate images the agent may look at. */
  views: number;
  /** Function-call rounds before it must answer. */
  rounds: number;
  /** Time budget shared by every round of the attempt. */
  budgetMs: number;
}

/** Research depth (Advanced setting). All budgets fit inside the 1500s galleryRow task timeout. */
export const GALLERY_DEPTH_BUDGETS: Record<GalleryScrapingSettings["searchDepth"], GalleryDepthBudget> = {
  low: { pages: 10, views: 16, rounds: 15, budgetMs: 240_000 },
  medium: { pages: 20, views: 24, rounds: 22, budgetMs: 420_000 },
  high: { pages: 30, views: 36, rounds: 30, budgetMs: 540_000 },
};

export function galleryDepthBudget(depth: GalleryScrapingSettings["searchDepth"] | undefined): GalleryDepthBudget {
  return GALLERY_DEPTH_BUDGETS[depth ?? "high"] ?? GALLERY_DEPTH_BUDGETS.high;
}

export function galleryResearchSchema(maxCandidates: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["found", "not_found"] },
      productIdentity: {
        type: "string",
        description: "One line: brand, name, key identifier and variant of the matched item.",
      },
      images: {
        type: "array",
        description: "New gallery images of the exact item, best first, each from a page you opened.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string", description: "Direct image file link exactly as it appeared on the page you opened." },
            pageUrl: { type: "string", description: "The opened page of the same exact item where this link appeared." },
            perspective: { type: "string", enum: [...GALLERY_PERSPECTIVES] },
          },
          required: ["url", "pageUrl", "perspective"],
        },
        maxItems: Math.max(1, maxCandidates),
      },
      notes: {
        type: "string",
        description:
          "Pages used and what each contributed, perspectives still missing, and what was tried when fewer than requested were found.",
      },
    },
    required: ["status", "productIdentity", "images", "notes"],
  };
}

export interface GalleryResearchImage {
  imageUrl: string;
  pageUrl: string;
  perspective: GalleryPerspective;
  title: string;
}

export interface GalleryResearchResult {
  productIdentity: string;
  images: GalleryResearchImage[];
  /** Every billed Responses round, including rounds of a failed first attempt. */
  costs: AiCallCost[];
  searchCallCount: number;
  notes?: string;
  stats: {
    pagesOpened: number;
    imagesViewed: number;
    candidatesReturned: number;
    candidatesKept: number;
    unverified: number;
    rounds: number;
  };
  rejections: string[];
  unverifiedNote: string;
}

/** Image links are attached to the request as-is; local bytes arrive as data URLs. */
export async function researchGalleryImages(params: {
  rowData: Record<string, string>;
  selectedColumns: string[];
  /** Main image links (required image column), http(s) or empty. */
  mainImageUrls: string[];
  /** Extra input images that are not public links (data:image/... URLs), attached first. */
  extraInputImages?: string[];
  settings: GalleryScrapingSettings;
  requestedGalleryImages: number;
  shouldCancel?: () => Promise<boolean>;
}): Promise<GalleryResearchResult> {
  const count = Math.max(1, params.requestedGalleryImages);
  const budget = galleryDepthBudget(params.settings.searchDepth);
  const classified = classifyRowValues(params.rowData, params.selectedColumns);
  const rowText = textOnlyRow(classified);
  const rowIdentifiers = extractRowIdentifiers(rowText);
  const brief = buildGalleryBrief({
    classified,
    mainImageUrls: params.mainImageUrls,
    count,
    settings: params.settings,
    rowIdentifiers: rowIdentifiers.map((identifier) => identifier.value),
  });

  const ledger = new EvidenceLedger();
  const sourcePageKeys = new Set(brief.sourcePageUrls.map(normalizePageKey));
  const pages = createPageSession({
    rowIdentifiers,
    ledger,
    domainRules: { allowedDomains: [], blockedDomains: [] },
    maxFetches: budget.pages,
    maxFetchesPerSite: Math.max(4, Math.round(budget.pages * 0.5)),
  });
  const sizes = new Map<string, KnownImageSize>();
  let imagesViewed = 0;
  const tools = [
    createCheckPagesTool(pages),
    createFetchPageTool(pages),
    createViewImagesTool({
      maxViews: budget.views,
      load: async (url) => {
        imagesViewed += 1;
        const result = await loadImagePreview(url);
        if (result.ok && result.width && result.height) {
          sizes.set(normalizeImageKey(url), { width: result.width, height: result.height });
        }
        return result;
      },
    }),
  ];

  const knownImageKeys = buildKnownImageKeys(brief.knownImageUrls);
  let guardStats = { returned: 0, kept: 0, unverified: 0, rejections: [] as string[], notes: "" };
  let parsedIdentity = "";

  const parse: EnrichResponseParser = async ({ selection }) => {
    const answer = selection as unknown as GalleryAnswer;
    parsedIdentity = typeof answer.productIdentity === "string" ? answer.productIdentity.trim() : "";
    const guarded = guardGalleryAnswer({
      answer,
      ledger,
      rowIdentifiers,
      rowText,
      sourcePageKeys,
      knownImageKeys,
      sizes,
      prefs: params.settings,
    });
    if (guarded.rejections.length > 0) {
      console.warn("[Gallery research] Rejected by evidence checks", { rejections: guarded.rejections.slice(0, 12) });
    }
    const candidates = guarded.images.map((image) => ({
      imageUrl: image.imageUrl,
      pageUrl: image.pageUrl,
      title: `Gallery · ${image.perspective}`,
      perspective: image.perspective,
    }));
    const { images, unverified } = await keepLoadableImages(candidates, count);
    guardStats = {
      returned: Array.isArray(answer.images) ? answer.images.length : 0,
      kept: images.length,
      unverified,
      rejections: guarded.rejections,
      notes: typeof answer.notes === "string" ? answer.notes.trim() : "",
    };
    return { images };
  };

  const policy: EnrichToolPolicy = {
    needsImages: false,
    needsSources: false,
    needsCategories: false,
    textColumnIds: [],
    toolChoice: "required",
    searchContentTypes: ["text"],
    imageCount: brief.maxCandidates,
    sourceCount: 0,
    includeResults: false,
    includeSources: false,
  };

  galleryLog("gallery-research", "Starting gallery research", {
    model: GALLERY_SCRAPING_OPENAI_MODEL,
    depth: params.settings.searchDepth,
    count,
    inputImages: brief.inputImageUrls.length + (params.extraInputImages?.length ?? 0),
    sourcePages: brief.sourcePageUrls.length,
    identifiers: rowIdentifiers.length,
  });

  const result = await runEnrichOpenAiResponse({
    tier: "standard",
    promptText: brief.text,
    imageUrls: [...(params.extraInputImages ?? []), ...brief.inputImageUrls],
    policy,
    schemaName: "product_gallery_research",
    schema: galleryResearchSchema(brief.maxCandidates),
    enabledColumns: [],
    rowData: rowText,
    instructions: GALLERY_RESEARCH_SKILL,
    parse,
    modelOverride: GALLERY_SCRAPING_OPENAI_MODEL,
    reasoningEffortOverride: GALLERY_SCRAPING_REASONING_EFFORT,
    searchContextSizeOverride: "medium",
    functionTools: tools,
    maxFunctionRounds: budget.rounds,
    attemptBudgetMs: budget.budgetMs,
    shouldCancel: params.shouldCancel,
  });

  const found = (result.data.images as Array<{ imageUrl: string; pageUrl: string; title: string; perspective?: GalleryPerspective }>) ?? [];
  const images: GalleryResearchImage[] = found.map((image) => ({
    imageUrl: image.imageUrl,
    pageUrl: image.pageUrl,
    perspective: image.perspective ?? "other",
    title: image.title,
  }));

  const stats = {
    pagesOpened: ledger.size,
    imagesViewed,
    candidatesReturned: guardStats.returned,
    candidatesKept: images.length,
    unverified: guardStats.unverified,
    rounds: result.costs.length,
  };
  galleryLog("gallery-research", "Gallery research finished", {
    ...stats,
    searchCallCount: result.searchCallCount,
    rejected: guardStats.rejections.length,
  });

  return {
    productIdentity: parsedIdentity,
    images,
    costs: result.costs,
    searchCallCount: result.searchCallCount,
    notes: guardStats.notes || undefined,
    stats,
    rejections: guardStats.rejections,
    unverifiedNote: unverifiedImagesNote(guardStats.unverified),
  };
}
