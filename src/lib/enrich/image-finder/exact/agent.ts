import { PRODUCT_MODE_COLUMN_IDS, type ImageUrl } from "@/types";
import { createSearchApiCost } from "@/lib/ai-pricing";
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
import { verifyImageUrls } from "../verify-images";
import { buildExactImagesPrompt, IMAGE_FINDER_EXACT_IMAGES_SKILL } from "./images-skill";
import { checkExactLinks, type CheckedExactLink } from "./links-checks";
import { buildExactLinksQuery, EXACT_LINKS_MAX, parseExactLinksResult } from "./links-skill";
import { callGoogleAiMode } from "./searchapi";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;

export const EXACT_MATCH_BASIS = "exact";
export const EXACT_MATCH_NOTE =
  "Exact match — Google AI Mode found the product link; GPT-6 Sol confirmed it and pulled the images.";

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

/**
 * `%XX`-encoded characters can break an otherwise-real image URL (seen on a
 * CDN that serves `filters%3Aformat%28avif%29` as a path segment while the
 * plain `filters:format(avif)` form of the same URL loads); try the decoded
 * form too before giving up on a candidate.
 */
function decodedVariant(url: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(url)) return null;
  try {
    const decoded = decodeURIComponent(url);
    return decoded !== url ? decoded : null;
  } catch {
    return null;
  }
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
 * (links-checks.ts), Agent 2 (GPT-6 Sol, hosted web_search) opens them,
 * searches for more exact pages of the same item, and returns up to 7
 * images. No links survive → Not found, Agent 2 never runs, so the
 * SearchApi call is the only cost for that row.
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

  const query = buildExactLinksQuery({
    rowData: params.productData,
    rowIdentifiers: identifierValues,
    customInstruction,
  });

  const { text: linksText } = await callGoogleAiMode(query);
  const searchApiCost = createSearchApiCost(1);
  const linksResult = parseExactLinksResult(linksText);
  const checkedLinks: CheckedExactLink[] = checkExactLinks(
    linksResult.matches,
    identifierValues,
    IMAGE_FINDER_EXACT_MAX_LINKS
  );

  if (checkedLinks.length === 0) {
    return {
      data: {
        [IMAGE_COLUMN_ID]: [],
        [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]:
          "Google AI Mode found no exact-match product page for this item.",
        [imageFinderMatchBasisKey(IMAGE_COLUMN_ID)]: "",
        [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: "",
      },
      costs: [searchApiCost],
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
      // Agent 2 must have opened the page itself in this call — a known page
      // from Agent 1 is a lead, not proof, until Agent 2 confirms it here.
      if (!looksLikeDirectImageUrl(imageUrl) || !opened.has(pageKey(pageUrl))) continue;
      const key = imageUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ imageUrl, pageUrl, title: `${EXACT_MATCH_NOTE} Product image` });
    }
    const withinRules = filterImagesByDomainRules(candidates, domainRules);

    const variantsByUrl = new Map<string, string[]>();
    const toVerify: string[] = [];
    for (const candidate of withinRules) {
      const variants = [candidate.imageUrl];
      const decoded = decodedVariant(candidate.imageUrl);
      if (decoded) variants.push(decoded);
      variantsByUrl.set(candidate.imageUrl, variants);
      toVerify.push(...variants);
    }
    const loadable = await verifyImageUrls(toVerify);
    const images: ImageUrl[] = [];
    for (const candidate of withinRules) {
      if (images.length >= brief.imageCount) break;
      const variants = variantsByUrl.get(candidate.imageUrl) ?? [candidate.imageUrl];
      const working = variants.find((variant) => loadable.has(variant.toLowerCase()));
      if (!working) continue;
      images.push({ ...candidate, imageUrl: working });
    }

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
      [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: matched ? EXACT_MATCH_NOTE : "",
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
    return { data: result.data, costs: [searchApiCost, ...result.costs] };
  } catch (error) {
    // SearchApi already billed this row (Agent 1 ran) even when Agent 2's
    // OpenAI call fails outright, so its cost must ride along on every
    // error path — including a plain Error with zero OpenAI cost billed.
    const extraCosts = [searchApiCost, ...billedCostsOf(error)];
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof EnrichCancelledError) throw new EnrichCancelledError(message, extraCosts);
    if (error instanceof EnrichProviderUnavailableError) throw new EnrichProviderUnavailableError(message, extraCosts);
    throw new EnrichBilledAttemptError(message, extraCosts);
  }
}
