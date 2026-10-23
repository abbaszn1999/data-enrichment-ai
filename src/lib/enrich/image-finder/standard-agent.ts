import { PRODUCT_MODE_COLUMN_IDS, type ImageUrl } from "@/types";
import { filterImagesByDomainRules, hasDomainRules, sanitizeDomainRules } from "../domains";
import { IMAGE_FINDER_OPENAI_MODEL, IMAGE_FINDER_REASONING_EFFORT } from "../models";
import { runEnrichOpenAiResponse, type EnrichResponseParser } from "../openai";
import { buildEnrichToolPolicy } from "../policy";
import { collectOpenedPages, looksLikeWebPageUrl } from "../tool-results";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { buildImageFinderBrief } from "./brief";
import { prepareKnownPages } from "./known-pages";
import { imageFinderMatchBasisKey, imageFinderMatchNoteKey, imageFinderNotFoundKey } from "./not-found";
import { IMAGE_FINDER_STANDARD_SKILL } from "./standard-skill";
import { extractRowIdentifiers } from "./tools/identifiers";
import { keepLoadableImages, unverifiedImagesNote } from "./verify-images";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;

/** Time budget for the single call (it searches and browses inside one turn). */
export const IMAGE_FINDER_STANDARD_BUDGET_MS = 300_000;

export const STANDARD_MATCH_BASIS = "standard";
export const STANDARD_MATCH_NOTE = "Quick match from web search: the page was not independently verified.";

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

/** The agent's web citations come back as markdown, including empty `([]())` ones: show plain text. */
function plainReason(text: string): string {
  return text
    .replace(/\s*\(\[\]\(\)\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Why images the agent returned were not kept, by the check that dropped them. */
interface ImageDrops {
  notAnImageLink: number;
  pageNotOpened: number;
  duplicate: number;
  websiteRules: number;
  didNotLoad: number;
}

function emptyDrops(): ImageDrops {
  return { notAnImageLink: 0, pageNotOpened: 0, duplicate: 0, websiteRules: 0, didNotLoad: 0 };
}

const DROP_LABELS: Record<keyof ImageDrops, string> = {
  notAnImageLink: "not an image link",
  pageNotOpened: "from a page that was not opened during the search",
  duplicate: "duplicate",
  websiteRules: "excluded by the website rules",
  didNotLoad: "did not load as an image",
};

/** "The matched item's images could not be confirmed (3 returned: 2 from a page that was not opened during the search, 1 did not load as an image)." */
function foundButDroppedReason(returned: number, drops: ImageDrops): string {
  const parts = (Object.keys(DROP_LABELS) as Array<keyof ImageDrops>)
    .filter((key) => drops[key] > 0)
    .map((key) => `${drops[key]} ${DROP_LABELS[key]}`);
  if (returned === 0) return "The agent reported the item as found but returned no image links.";
  return `The matched item's images could not be confirmed (${returned} returned${parts.length ? `: ${parts.join(", ")}` : ""}).`;
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
 * Image Finder: one Responses call with the hosted web_search tool only, so
 * openai.ts sends exactly one request and never enters its round loop. Pages
 * from a ticked Source URLs column go into the brief as leads to open first.
 * An image is kept when its page was opened (or is a known Source URLs page),
 * the load check does not prove it is a non-image, and it passes the website
 * rules. The path of the link is never guessed at — shops serve pictures from
 * addresses of every kind. The page content is not independently re-read, so
 * every result is labelled.
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
  const knownPages = prepareKnownPages(params.knownPages, domainRules);
  const brief = buildImageFinderBrief({
    rowData: params.productData,
    sheetImageUrls: params.sourceImageUrls,
    customInstruction: column?.customInstruction,
    allowedDomains: domainRules.allowedDomains,
    blockedDomains: domainRules.blockedDomains,
    rowIdentifiers: extractRowIdentifiers(params.productData).map((identifier) => identifier.value),
    learnedDomains: params.learnedDomains,
    knownPages,
    recheck: params.recheck,
  });

  const parse: EnrichResponseParser = async ({ selection, response }) => {
    const notes = typeof selection.notes === "string" ? selection.notes.trim() : "";
    const found = selection.status === "found";
    // Known pages were already found for this item (Source URLs). If the model
    // took images from one of them, keep them even when the tool log omitted
    // the matching open_page action.
    const opened = new Set([
      ...collectOpenedPages(response).map(pageKey),
      ...knownPages.map((page) => pageKey(page.url)),
    ]);
    const seen = new Set<string>();
    const candidates: ImageUrl[] = [];
    const drops = emptyDrops();
    const returned = found && Array.isArray(selection.images) ? selection.images : [];
    for (const item of returned) {
      const record = (item ?? {}) as { url?: unknown; pageUrl?: unknown };
      const imageUrl = String(record.url ?? "").trim();
      const pageUrl = String(record.pageUrl ?? "").trim();
      // The shape of an image link is not judged here: shops serve pictures from
      // addresses of every kind (`/medias/?context=...`), and the load check below
      // is what tells a picture from a page. Only what can never be a picture
      // is refused: not an https link, or the product page itself.
      if (!/^https:\/\//i.test(imageUrl) || !isUrl(imageUrl) || pageKey(imageUrl) === pageKey(pageUrl)) {
        drops.notAnImageLink += 1;
        continue;
      }
      if (!opened.has(pageKey(pageUrl))) {
        drops.pageNotOpened += 1;
        continue;
      }
      const key = imageUrl.toLowerCase();
      if (seen.has(key)) {
        drops.duplicate += 1;
        continue;
      }
      seen.add(key);
      candidates.push({ imageUrl, pageUrl, title: `${STANDARD_MATCH_NOTE} Product image` });
    }
    const withinRules = filterImagesByDomainRules(candidates, domainRules);
    drops.websiteRules = candidates.length - withinRules.length;
    const { images, unverified, failed } = await keepLoadableImages(withinRules, brief.imageCount, {
      // A link that is plainly a web page is kept only if it was confirmed to load as an image.
      requireConfirmed: (candidate) => looksLikeWebPageUrl(candidate.imageUrl),
    });
    drops.didNotLoad = failed;

    let reason = "";
    if (images.length === 0) {
      // The agent said it found the item but nothing was kept: say which check dropped what,
      // in the row's note and in the logs, so a mistake of ours can never pass as "not found".
      if (found) {
        reason = foundButDroppedReason(returned.length, drops);
        console.warn("[Image Finder] The agent found the item but no image was kept", {
          returned: returned.length,
          ...drops,
          opened: opened.size,
        });
      }
      if (notes) reason = plainReason(`${reason} ${notes}`);
    }
    // Always write the sibling keys so a later run clears stale values from an earlier one.
    const matched = images.length > 0;
    return {
      [IMAGE_COLUMN_ID]: images,
      [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: reason,
      [imageFinderMatchBasisKey(IMAGE_COLUMN_ID)]: matched ? STANDARD_MATCH_BASIS : "",
      [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: matched
        ? [STANDARD_MATCH_NOTE, unverifiedImagesNote(unverified)].filter(Boolean).join(" ")
        : "",
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
