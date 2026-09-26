import {
  PRODUCT_MODE_COLUMN_IDS,
  resolveEnrichmentModel,
  type ImageUrl,
  type SessionKind,
} from "@/types";
import {
  filterImagesByDomainRules,
  hasDomainRules,
  sanitizeDomainRules,
} from "../domains";
import { IMAGE_FINDER_OPENAI_MODEL, IMAGE_FINDER_REASONING_EFFORT } from "../models";
import { runEnrichOpenAiResponse, type EnrichResponseParser } from "../openai";
import { buildEnrichToolPolicy } from "../policy";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { buildImageFinderBrief } from "./brief";
import { EvidenceLedger } from "./evidence";
import { guardImageFinderAnswer, type ImageFinderAnswer } from "./guards";
import { imageFinderMatchBasisKey, imageFinderMatchNoteKey, imageFinderNotFoundKey } from "./not-found";
import { IMAGE_FINDER_SKILL } from "./skill";
import { createCheckPagesTool } from "./tools/check-pages";
import { createFetchPageTool, createPageSession } from "./tools/fetch-page";
import { extractRowIdentifiers } from "./tools/identifiers";
import { createViewImagesTool } from "./tools/view-images";
import { verifyImageUrls } from "./verify-images";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;

/** Research budget for one attempt; two attempts fit inside the row task timeout. */
export const IMAGE_FINDER_ATTEMPT_BUDGET_MS = 540_000;
export const IMAGE_FINDER_MAX_ROUNDS = 30;

/** Image Finder mode sends exactly one column: the product image column. */
export function isImageFinderRun(
  kind: SessionKind,
  enabledColumns: string[]
): boolean {
  return (
    kind === "product" &&
    enabledColumns.length === 1 &&
    enabledColumns[0] === IMAGE_COLUMN_ID
  );
}

function imageFinderSchema(imageCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["found", "not_found"] },
      verification: {
        type: "object",
        additionalProperties: false,
        properties: {
          pageUrl: {
            type: "string",
            description: "The page you opened (fetch_page or check_pages) where the exact item was verified. Empty when not found.",
          },
          identifierSeen: {
            type: "string",
            description:
              "One identifier (the strongest) exactly as it appears on that page; for a near code, the page's code. Empty when not found or when the row has no code.",
          },
          brandSeen: {
            type: "string",
            description: "The brand exactly as the page shows it. Required for a best match; empty when unknown.",
          },
          matchBasis: {
            type: "string",
            enum: ["identifier", "near_identifier", "model_variant", "best_match", "none"],
          },
        },
        required: ["pageUrl", "identifierSeen", "brandSeen", "matchBasis"],
      },
      images: {
        type: "array",
        description: "Every distinct image of the exact verified item its sources show, best first, up to 7.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string", description: "Image link exactly as it appeared on a page you opened." },
            pageUrl: { type: "string", description: "The opened page of the same exact item where this image link appeared." },
          },
          required: ["url", "pageUrl"],
        },
        maxItems: imageCount,
      },
      notes: {
        type: "string",
        description:
          "What confirmed the match and any differences from the sheet; or, when not found, the approaches, websites and terms tried and the candidates rejected.",
      },
    },
    required: ["status", "verification", "images", "notes"],
  };
}

function displayPageUrl(pageUrl: string): string {
  return pageUrl.replace(/(\/products\/[^/?#]+)\.(json|js)(?=$|[?#])/i, "$1");
}

/**
 * Dedicated Image Finder agent for Catalog Intelligence: a multi-step
 * research loop (web_search + fetch_page + view_images) whose answer is only
 * accepted where our own tools' evidence backs it up. Shares the Responses
 * transport and cost calculation with the enrichment agent, so every round is
 * billed exactly like any other Catalog Intelligence row.
 */
export async function findProductImages(
  params: EnrichAgentParams
): Promise<EnrichAgentResult> {
  const tier = resolveEnrichmentModel(params.settings?.enrichmentModel);
  const basePolicy = buildEnrichToolPolicy([IMAGE_COLUMN_ID], params.enrichmentColumns, "product");
  // Images come from pages our fetch tool opened, so web search only needs text results.
  const policy = { ...basePolicy, searchContentTypes: ["text" as const], includeResults: false };
  const column = params.enrichmentColumns?.find((c) => c.id === IMAGE_COLUMN_ID);
  const domainRules = sanitizeDomainRules({
    allowedDomains: column?.allowedDomains,
    blockedDomains: column?.blockedDomains,
  });
  const rowIdentifiers = extractRowIdentifiers(params.productData);
  const brief = buildImageFinderBrief({
    rowData: params.productData,
    customInstruction: column?.customInstruction,
    allowedDomains: domainRules.allowedDomains,
    blockedDomains: domainRules.blockedDomains,
    rowIdentifiers: rowIdentifiers.map((identifier) => identifier.value),
    learnedDomains: params.learnedDomains,
    recheck: params.recheck,
  });

  const ledger = new EvidenceLedger();
  const pages = createPageSession({ rowIdentifiers, ledger, domainRules });
  const tools = [createCheckPagesTool(pages), createFetchPageTool(pages), createViewImagesTool()];

  const parse: EnrichResponseParser = async ({ selection }) => {
    const answer = selection as unknown as ImageFinderAnswer;
    const notes = typeof answer.notes === "string" ? answer.notes.trim() : "";
    const guarded = guardImageFinderAnswer({ answer, ledger, rowIdentifiers, rowData: params.productData });
    if (guarded.rejections.length > 0) {
      console.warn("[Image Finder] Rejected by evidence checks", { rejections: guarded.rejections });
    }

    const candidates = guarded.images.map((image) => ({
      imageUrl: image.imageUrl,
      pageUrl: displayPageUrl(image.pageUrl),
      title: guarded.matchNote ? `${guarded.matchNote} Product image` : "Product image",
    }));
    const withinRules = filterImagesByDomainRules(candidates, domainRules);
    const loadable = await verifyImageUrls(withinRules.map((c) => c.imageUrl));
    const images: ImageUrl[] = withinRules
      .filter((c) => loadable.has(c.imageUrl.toLowerCase()))
      .slice(0, brief.imageCount);

    let reason = "";
    if (images.length === 0) {
      reason = guarded.found
        ? `Verified the item on ${displayPageUrl(guarded.verifiedPageUrl ?? "")} but none of its images could be confirmed.`
        : guarded.rejections[0] ?? notes ?? "";
      if (notes && reason !== notes) reason = `${reason} ${notes}`.trim();
    }
    // Always write the sibling keys so a later run clears stale values from an earlier one.
    const matched = images.length > 0;
    return {
      [IMAGE_COLUMN_ID]: images,
      [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: reason,
      [imageFinderMatchBasisKey(IMAGE_COLUMN_ID)]: matched ? guarded.matchBasis ?? "" : "",
      [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: matched ? guarded.matchNote : "",
    };
  };

  const result = await runEnrichOpenAiResponse({
    tier,
    promptText: brief.text,
    imageUrls: brief.referenceImageUrls,
    policy,
    schemaName: "catalog_image_finder",
    schema: imageFinderSchema(brief.imageCount),
    enabledColumns: [IMAGE_COLUMN_ID],
    enrichmentColumns: params.enrichmentColumns,
    kind: "product",
    rowData: params.productData,
    instructions: IMAGE_FINDER_SKILL,
    parse,
    webSearchFilters: hasDomainRules(domainRules) ? domainRules : undefined,
    modelOverride: IMAGE_FINDER_OPENAI_MODEL,
    reasoningEffortOverride: IMAGE_FINDER_REASONING_EFFORT,
    // Search only discovers pages; fetch_page reads them, so large search
    // result content would just be re-billed on every round.
    searchContextSizeOverride: "medium",
    functionTools: tools,
    maxFunctionRounds: IMAGE_FINDER_MAX_ROUNDS,
    attemptBudgetMs: IMAGE_FINDER_ATTEMPT_BUDGET_MS,
    shouldCancel: params.shouldCancel,
  });

  return { data: result.data, costs: result.costs };
}
