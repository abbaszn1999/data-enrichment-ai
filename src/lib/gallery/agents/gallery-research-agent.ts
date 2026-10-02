/**
 * Products Gallery scraping agent: ONE GPT-6.1 Sol request per row.
 *
 * Inputs: a short skill, the checked source columns (text), the Main image(s)
 * and the row's other images (attached), the settings, and the list of images
 * the sheet already has. Source-page links in the checked columns are listed
 * as "Known source pages"; the model opens them itself, searches the web
 * (text + image results) and answers once. Code then removes known/duplicate/
 * tiny images and load-checks every link.
 */
import type { AiCallCost } from "@/lib/ai-pricing";
import { GALLERY_SCRAPING_OPENAI_MODEL, GALLERY_SCRAPING_REASONING_EFFORT } from "@/lib/enrich/models";
import { runEnrichOpenAiResponse, type EnrichResponseParser } from "@/lib/enrich/openai";
import type { EnrichToolPolicy } from "@/lib/enrich/policy";
import { collectToolImages } from "@/lib/enrich/tool-results";
import { normalizeImageKey } from "@/lib/enrich/image-finder/evidence";
import { extractRowIdentifiers } from "@/lib/enrich/image-finder/tools/identifiers";
import { loadImagePreview } from "@/lib/enrich/image-finder/tools/view-images";
import { keepLoadableImages, unverifiedImagesNote } from "@/lib/enrich/image-finder/verify-images";
import { galleryLog } from "@/lib/gallery/log";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";
import { buildGalleryBrief, classifyRowValues, textOnlyRow } from "./gallery-brief";
import {
  GALLERY_PERSPECTIVES,
  buildKnownImageKeys,
  buildSeenImageIndex,
  guardGalleryCandidates,
  rankGalleryImages,
  type GalleryAnswer,
  type GalleryPerspective,
  type KnownImageSize,
} from "./gallery-guards";
import { GALLERY_RESEARCH_SKILL } from "./gallery-research-skill";

export interface GalleryDepthBudget {
  /** How much page content the web search reads per query. */
  searchContext: "low" | "medium" | "high";
  /** Raw image results the web search returns to the model. */
  imagePool: number;
  /** Time budget for the single request. */
  budgetMs: number;
}

/** Research depth (Advanced setting). All budgets fit inside the 1500s galleryRow task timeout. */
export const GALLERY_DEPTH_BUDGETS: Record<GalleryScrapingSettings["searchDepth"], GalleryDepthBudget> = {
  low: { searchContext: "low", imagePool: 20, budgetMs: 240_000 },
  medium: { searchContext: "medium", imagePool: 30, budgetMs: 360_000 },
  high: { searchContext: "high", imagePool: 40, budgetMs: 480_000 },
};

export function galleryDepthBudget(depth: GalleryScrapingSettings["searchDepth"] | undefined): GalleryDepthBudget {
  return GALLERY_DEPTH_BUDGETS[depth ?? "high"] ?? GALLERY_DEPTH_BUDGETS.high;
}

/** Most images measured (downloaded) after the model answers. */
const MEASURE_CONCURRENCY = 4;

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
        description: "New gallery images of the exact item, best first, each link copied exactly as you saw it.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string", description: "Direct image file link exactly as seen on a page or in the image search results." },
            pageUrl: { type: "string", description: "The page of the same exact item where this link appeared, or an empty string." },
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
  /** Every billed Responses round, including a failed first attempt. */
  costs: AiCallCost[];
  searchCallCount: number;
  notes?: string;
  stats: {
    /** Known source pages handed to the agent (it opens them itself). */
    pagesOpened: number;
    /** Images downloaded to read their size. */
    imagesViewed: number;
    candidatesReturned: number;
    candidatesKept: number;
    unverified: number;
    rounds: number;
  };
  rejections: string[];
  unverifiedNote: string;
}

async function mapWithLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
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
  const briefInput = {
    classified,
    mainImageUrls: params.mainImageUrls,
    count,
    settings: params.settings,
    rowIdentifiers: rowIdentifiers.map((identifier) => identifier.value),
  };
  const brief = buildGalleryBrief(briefInput);
  const knownImageKeys = buildKnownImageKeys(brief.knownImageUrls);

  let guardStats = { returned: 0, unverified: 0, rejections: [] as string[], notes: "" };
  let parsedIdentity = "";
  let imagesViewed = 0;

  const parse: EnrichResponseParser = async ({ selection, response }) => {
    const answer = selection as unknown as GalleryAnswer;
    parsedIdentity = typeof answer.productIdentity === "string" ? answer.productIdentity.trim() : "";

    const seen = buildSeenImageIndex(collectToolImages(response));
    const guarded = guardGalleryCandidates({ answer, seen, knownImageKeys });

    // Read each kept image's size (best effort): tiny ones are dropped, preferred sizes go first.
    const sizes = new Map<string, KnownImageSize>();
    await mapWithLimit(guarded.images, MEASURE_CONCURRENCY, async (image) => {
      imagesViewed += 1;
      const preview = await loadImagePreview(image.imageUrl);
      if (preview.ok && preview.width && preview.height) {
        sizes.set(normalizeImageKey(image.imageUrl), { width: preview.width, height: preview.height });
      }
    });
    const ranked = rankGalleryImages(guarded.images, sizes, params.settings);
    const rejections = [...guarded.rejections, ...ranked.rejections];
    if (rejections.length > 0) {
      console.warn("[Gallery research] Rejected by checks", { rejections: rejections.slice(0, 12) });
    }

    const candidates = ranked.images.map((image) => ({
      imageUrl: image.imageUrl,
      pageUrl: image.pageUrl,
      title: `Gallery · ${image.perspective}`,
      perspective: image.perspective,
    }));
    const { images, unverified } = await keepLoadableImages(candidates, count);
    guardStats = {
      returned: Array.isArray(answer.images) ? answer.images.length : 0,
      unverified,
      rejections,
      notes: typeof answer.notes === "string" ? answer.notes.trim() : "",
    };
    return { images };
  };

  const policy: EnrichToolPolicy = {
    needsImages: true,
    needsSources: false,
    needsCategories: false,
    textColumnIds: [],
    toolChoice: "required",
    searchContentTypes: ["image", "text"],
    imageCount: brief.maxCandidates,
    sourceCount: 0,
    includeResults: true,
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
    searchContextSizeOverride: budget.searchContext,
    imageSearchPoolSize: budget.imagePool,
    attemptBudgetMs: budget.budgetMs,
    shouldCancel: params.shouldCancel,
  });

  const found =
    (result.data.images as Array<{ imageUrl: string; pageUrl: string; title: string; perspective?: GalleryPerspective }>) ?? [];
  const images: GalleryResearchImage[] = found.map((image) => ({
    imageUrl: image.imageUrl,
    pageUrl: image.pageUrl,
    perspective: image.perspective ?? "other",
    title: image.title,
  }));

  const stats = {
    pagesOpened: brief.sourcePageUrls.length,
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
