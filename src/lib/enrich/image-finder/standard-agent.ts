import { PRODUCT_MODE_COLUMN_IDS, type ImageUrl } from "@/types";
import { filterImagesByDomainRules, hasDomainRules, sanitizeDomainRules } from "../domains";
import { IMAGE_FINDER_OPENAI_MODEL, IMAGE_FINDER_REASONING_EFFORT } from "../models";
import { runEnrichOpenAiResponse, type EnrichResponseParser } from "../openai";
import { buildEnrichToolPolicy } from "../policy";
import { collectOpenedPages, looksLikeDirectImageUrl } from "../tool-results";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { buildImageFinderBrief } from "./brief";
import { imageFinderMatchBasisKey, imageFinderMatchNoteKey, imageFinderNotFoundKey } from "./not-found";
import { IMAGE_FINDER_STANDARD_SKILL } from "./standard-skill";
import { extractRowIdentifiers } from "./tools/identifiers";
import { verifyImageUrls } from "./verify-images";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;

/** Time budget for Standard's single call (it searches and browses inside one turn). */
export const IMAGE_FINDER_STANDARD_BUDGET_MS = 300_000;

export const STANDARD_MATCH_BASIS = "standard";
export const STANDARD_MATCH_NOTE = "Fast match from web search — not independently page-verified.";

function standardSchema(imageCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["found", "not_found"] },
      images: {
        type: "array",
        description: "Images of the matched item, best first; empty when not found.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string", description: "Direct image file link exactly as it appeared on the page you opened." },
            pageUrl: { type: "string", description: "The page of the matched item you opened where this image appeared." },
          },
          required: ["url", "pageUrl"],
        },
        maxItems: imageCount,
      },
      notes: {
        type: "string",
        description:
          "When found: retailer, listed title, displayed identifier, price and any differences from the row. When not found: the approaches, websites and terms tried and the candidates rejected.",
      },
    },
    required: ["status", "images", "notes"],
  };
}

/** Host without `www.` plus path without trailing slash; query and hash dropped. */
function pageKey(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Standard-tier Image Finder: one Responses call with the hosted web_search
 * tool only — no function tools, so openai.ts sends exactly one request and
 * never enters its round loop. An image is kept only when its page was
 * really opened by web_search in that same call, the link is a direct image
 * that actually loads, and it passes the website rules. The page content is
 * not independently re-read, so every result is labelled.
 */
export async function findProductImagesStandard(params: EnrichAgentParams): Promise<EnrichAgentResult> {
  const basePolicy = buildEnrichToolPolicy([IMAGE_COLUMN_ID], params.enrichmentColumns, "product");
  // Image search results are mostly photos of similar products; the images
  // come from the matched item's own page, so search needs text only.
  const policy = {
    ...basePolicy,
    toolChoice: "required" as const,
    searchContentTypes: ["text" as const],
    includeResults: false,
  };
  const column = params.enrichmentColumns?.find((c) => c.id === IMAGE_COLUMN_ID);
  const domainRules = sanitizeDomainRules({
    allowedDomains: column?.allowedDomains,
    blockedDomains: column?.blockedDomains,
  });
  const brief = buildImageFinderBrief({
    rowData: params.productData,
    customInstruction: column?.customInstruction,
    allowedDomains: domainRules.allowedDomains,
    blockedDomains: domainRules.blockedDomains,
    rowIdentifiers: extractRowIdentifiers(params.productData).map((identifier) => identifier.value),
    learnedDomains: params.learnedDomains,
    variant: "standard",
  });

  const parse: EnrichResponseParser = async ({ selection, response }) => {
    const notes = typeof selection.notes === "string" ? selection.notes.trim() : "";
    const found = selection.status === "found";
    const opened = new Set(collectOpenedPages(response).map(pageKey));
    const seen = new Set<string>();
    const candidates: ImageUrl[] = [];
    for (const item of found && Array.isArray(selection.images) ? selection.images : []) {
      const record = (item ?? {}) as { url?: unknown; pageUrl?: unknown };
      const imageUrl = String(record.url ?? "").trim();
      const pageUrl = String(record.pageUrl ?? "").trim();
      if (!looksLikeDirectImageUrl(imageUrl) || !opened.has(pageKey(pageUrl))) continue;
      const key = imageUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ imageUrl, pageUrl, title: `${STANDARD_MATCH_NOTE} Product image` });
    }
    const withinRules = filterImagesByDomainRules(candidates, domainRules);
    const loadable = await verifyImageUrls(withinRules.map((image) => image.imageUrl));
    const images = withinRules
      .filter((image) => loadable.has(image.imageUrl.toLowerCase()))
      .slice(0, brief.imageCount);

    let reason = "";
    if (images.length === 0) {
      reason = found ? "The matched item's images could not be confirmed from a page opened during the search." : "";
      if (notes) reason = `${reason} ${notes}`.trim();
    }
    // Always write the sibling keys so a later run clears stale values from an earlier one.
    const matched = images.length > 0;
    return {
      [IMAGE_COLUMN_ID]: images,
      [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: reason,
      [imageFinderMatchBasisKey(IMAGE_COLUMN_ID)]: matched ? STANDARD_MATCH_BASIS : "",
      [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: matched ? STANDARD_MATCH_NOTE : "",
    };
  };

  const result = await runEnrichOpenAiResponse({
    tier: "standard",
    promptText: brief.text,
    imageUrls: brief.referenceImageUrls,
    policy,
    schemaName: "catalog_image_finder_standard",
    schema: standardSchema(brief.imageCount),
    enabledColumns: [IMAGE_COLUMN_ID],
    enrichmentColumns: params.enrichmentColumns,
    kind: "product",
    rowData: params.productData,
    instructions: IMAGE_FINDER_STANDARD_SKILL,
    parse,
    webSearchFilters: hasDomainRules(domainRules) ? domainRules : undefined,
    modelOverride: IMAGE_FINDER_OPENAI_MODEL,
    reasoningEffortOverride: IMAGE_FINDER_REASONING_EFFORT,
    searchContextSizeOverride: "medium",
    attemptBudgetMs: IMAGE_FINDER_STANDARD_BUDGET_MS,
    shouldCancel: params.shouldCancel,
  });

  return { data: result.data, costs: result.costs };
}
