import { PRODUCT_MODE_COLUMN_IDS, type ImageUrl } from "@/types";
import { filterImagesByDomainRules, hasDomainRules, sanitizeDomainRules } from "../../domains";
import { IMAGE_FINDER_OPENAI_MODEL, IMAGE_FINDER_REASONING_EFFORT } from "../../models";
import {
  billedCostsOf,
  EnrichBilledAttemptError,
  EnrichCancelledError,
  EnrichProviderUnavailableError,
  runEnrichOpenAiResponse,
  type EnrichResponseParser,
} from "../../openai";
import { buildEnrichToolPolicy } from "../../policy";
import { collectOpenedPages, looksLikeDirectImageUrl } from "../../tool-results";
import type { EnrichAgentParams, EnrichAgentResult } from "../../types";
import { imageFinderMatchBasisKey, imageFinderMatchNoteKey, imageFinderNotFoundKey } from "../not-found";
import { extractRowIdentifiers } from "../tools/identifiers";
import { keepLoadableImages, unverifiedImagesNote } from "../verify-images";
import { buildExactImagesPrompt, IMAGE_FINDER_EXACT_IMAGES_SKILL } from "./images-skill";
import type { CheckedExactLink } from "./links-checks";
import { EXACT_LINKS_MAX } from "./links-skill";
import { searchExactLinks } from "./links-search";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;

export const EXACT_MATCH_BASIS = "exact";
export const EXACT_MATCH_NOTE =
  "Exact match: the product page was confirmed and its images were taken from it.";

/** Agent 2 has no function tools (matches Standard's one-shot design): a single OpenAI call. */
export const IMAGE_FINDER_EXACT_BUDGET_MS = 300_000;
/** Agent 1 (Google AI Mode) hands Agent 2 at most this many checked links. */
export const IMAGE_FINDER_EXACT_MAX_LINKS = EXACT_LINKS_MAX;

function exactImagesSchema(imageCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["found", "not_found"] },
      images: {
        type: "array",
        description: "Up to 7 genuinely different images of the confirmed item, best first; empty when not found.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string", description: "Direct image file link exactly as it appeared on the page you opened." },
            pageUrl: { type: "string", description: "The page of the confirmed item you opened where this image appeared." },
            source: {
              type: "string",
              enum: ["known", "new"],
              description:
                "'known' if pageUrl was one of the known exact-match pages given to you; 'new' if you found that page yourself.",
            },
          },
          required: ["url", "pageUrl", "source"],
        },
        maxItems: imageCount,
      },
      notes: {
        type: "string",
        description:
          "When found: what confirmed each page and any differences from the row. When not found: what happened to each known page and what else was tried.",
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
 * Exact Match Image Finder: Agent 1 (Google AI Mode via SearchApi) finds
 * exact-match product-page links; if any survive the code checks
 * (links-checks.ts), Agent 2 (GPT-6.1 Sol, hosted web_search) opens them,
 * searches for more exact pages of the same item, and returns up to 7
 * images. If the first search yields no usable link, Agent 1 automatically
 * searches once more with different angles (links-search.ts). Still no
 * links â†’ Not found with a note saying what each search returned, and
 * Agent 2 never runs, so the SearchApi calls are the only cost for that row.
 */
export async function findProductImagesExact(
  params: EnrichAgentParams
): Promise<EnrichAgentResult> {
  const column = params.enrichmentColumns?.find((c) => c.id === IMAGE_COLUMN_ID);
  const customInstruction = column?.customInstruction;
  const domainRules = sanitizeDomainRules({
    allowedDomains: column?.allowedDomains,
    blockedDomains: column?.blockedDomains,
  });
  const rowIdentifiers = extractRowIdentifiers(params.productData);
  const identifierValues = rowIdentifiers.map((identifier) => identifier.value);

  const linksSearch = await searchExactLinks({
    rowData: params.productData,
    rowIdentifiers: identifierValues,
    customInstruction,
    domainRules,
    shouldCancel: params.shouldCancel,
  });
  const checkedLinks: CheckedExactLink[] = linksSearch.links;

  if (checkedLinks.length === 0) {
    return {
      data: {
        [IMAGE_COLUMN_ID]: [],
        [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: linksSearch.notFoundReason,
        [imageFinderMatchBasisKey(IMAGE_COLUMN_ID)]: "",
        [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: "",
      },
      costs: linksSearch.costs,
    };
  }
  const basePolicy = buildEnrichToolPolicy([IMAGE_COLUMN_ID], params.enrichmentColumns, "product");
  // Images come from pages Agent 2 opened itself, so web search only needs text results.
  const policy = { ...basePolicy, toolChoice: "required" as const, searchContentTypes: ["text" as const], includeResults: false };
  const brief = buildExactImagesPrompt({
    rowData: params.productData,
    customInstruction,
    allowedDomains: domainRules.allowedDomains,
    blockedDomains: domainRules.blockedDomains,
    rowIdentifiers: identifierValues,
    learnedDomains: params.learnedDomains,
    knownPages: checkedLinks,
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
      // Agent 2 must have opened the page itself in this call â€” a known page
      // from Agent 1 is a lead, not proof, until Agent 2 confirms it here.
      if (!looksLikeDirectImageUrl(imageUrl) || !opened.has(pageKey(pageUrl))) continue;
      const key = imageUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ imageUrl, pageUrl, title: `${EXACT_MATCH_NOTE} Product image` });
    }
    const withinRules = filterImagesByDomainRules(candidates, domainRules);

    const { images, unverified } = await keepLoadableImages(withinRules, brief.imageCount);

    let reason = "";
    if (images.length === 0) {
      reason = found
        ? "Confirmed the item but none of its images could be verified."
        : notes || `Checked ${checkedLinks.length} exact-match link(s) but could not confirm the item or its images.`;
      if (notes && reason !== notes) reason = `${reason} ${notes}`.trim();
    }
    const matched = images.length > 0;
    return {
      [IMAGE_COLUMN_ID]: images,
      [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: reason,
      [imageFinderMatchBasisKey(IMAGE_COLUMN_ID)]: matched ? EXACT_MATCH_BASIS : "",
      [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: matched
        ? [EXACT_MATCH_NOTE, unverifiedImagesNote(unverified)].filter(Boolean).join(" ")
        : "",
    };
  };

  try {
    const result = await runEnrichOpenAiResponse({
      tier: "exact",
      promptText: brief.text,
      imageUrls: brief.referenceImageUrls,
      policy,
      schemaName: "catalog_image_finder_exact",
      schema: exactImagesSchema(brief.imageCount),
      enabledColumns: [IMAGE_COLUMN_ID],
      enrichmentColumns: params.enrichmentColumns,
      kind: "product",
      rowData: params.productData,
      instructions: IMAGE_FINDER_EXACT_IMAGES_SKILL,
      parse,
      webSearchFilters: hasDomainRules(domainRules) ? domainRules : undefined,
      modelOverride: IMAGE_FINDER_OPENAI_MODEL,
      reasoningEffortOverride: IMAGE_FINDER_REASONING_EFFORT,
      searchContextSizeOverride: "high",
      attemptBudgetMs: IMAGE_FINDER_EXACT_BUDGET_MS,
      shouldCancel: params.shouldCancel,
    });
    return { data: result.data, costs: [...linksSearch.costs, ...result.costs] };
  } catch (error) {
    // SearchApi already billed this row (Agent 1 ran) even when Agent 2's
    // OpenAI call fails outright, so its cost must ride along on every
    // error path â€” including a plain Error with zero OpenAI cost billed.
    const extraCosts = [...linksSearch.costs, ...billedCostsOf(error)];
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof EnrichCancelledError) throw new EnrichCancelledError(message, extraCosts);
    if (error instanceof EnrichProviderUnavailableError) throw new EnrichProviderUnavailableError(message, extraCosts);
    throw new EnrichBilledAttemptError(message, extraCosts);
  }
}
