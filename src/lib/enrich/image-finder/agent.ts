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
import { runEnrichOpenAiResponse, type EnrichResponseParser } from "../openai";
import { buildEnrichToolPolicy } from "../policy";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { buildImageFinderBrief } from "./brief";
import { imageFinderNotFoundKey } from "./not-found";
import { imageFinderCandidatePoolSize } from "./pool-size";
import { IMAGE_FINDER_SKILL } from "./skill";
import { verifyImageUrls } from "./verify-images";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;

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

const IMAGE_FINDER_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

function imageFinderSchema(imageCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      images: {
        type: "array",
        description:
          "Best first, up to the requested number. Include lower-confidence matches marked accordingly rather than omitting them — confidence is informational only, never a reason to leave an image out.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: {
              type: "string",
              description:
                "A real image link you actually saw — from a search result, or read directly off a product page you opened and confirmed. Never a link you did not actually see, and never a page URL.",
            },
            pageUrl: {
              type: "string",
              description:
                "The page where you confirmed this product and saw this image link (the product page, or its .json version). Website rules are checked against this page, so images hosted on a store's CDN are kept.",
            },
            confidence: {
              type: "string",
              enum: [...IMAGE_FINDER_CONFIDENCE_LEVELS],
              description:
                "high: identifier verified on the source page, or two+ sources agree. medium: brand/model matched but not independently verified. low: best available match, meaningful uncertainty remains.",
            },
            matchedOn: {
              type: "string",
              description:
                "Short phrase: which identifiers or sources confirmed this image, e.g. \"SKU verified on source page\" or \"brand+model only\".",
            },
          },
          required: ["url", "pageUrl", "confidence", "matchedOn"],
        },
        maxItems: imageCount,
      },
      notes: {
        type: "string",
        description:
          "One or two short sentences: which identifiers were trusted or set aside and why, which sources were confirmed, and why any candidates were rejected or the list is shorter than requested.",
      },
    },
    required: ["images", "notes"],
  };
}

/** Prefixes a non-high-confidence image's caption; never changes which images are kept. */
function annotateConfidence(
  image: ImageUrl,
  meta: { confidence: string; matchedOn: string } | undefined
): ImageUrl {
  const confidence = meta?.confidence.toLowerCase();
  if (!confidence || confidence === "high") return image;
  const label = confidence === "medium" || confidence === "low" ? confidence : "unverified";
  const matchedOn = meta?.matchedOn ? ` — matched on ${meta.matchedOn}` : "";
  return { ...image, title: `${label} confidence${matchedOn}. ${image.title}`.slice(0, 300) };
}

/**
 * Dedicated Image Finder agent for Catalog Intelligence. Shares the Responses
 * transport and cost calculation with the enrichment agent, so its usage is
 * billed exactly like any other Catalog Intelligence row.
 */
export async function findProductImages(
  params: EnrichAgentParams
): Promise<EnrichAgentResult> {
  const tier = resolveEnrichmentModel(params.settings?.enrichmentModel);
  const policy = buildEnrichToolPolicy(
    [IMAGE_COLUMN_ID],
    params.enrichmentColumns,
    "product"
  );
  const column = params.enrichmentColumns?.find((c) => c.id === IMAGE_COLUMN_ID);
  const domainRules = sanitizeDomainRules({
    allowedDomains: column?.allowedDomains,
    blockedDomains: column?.blockedDomains,
  });
  const brief = buildImageFinderBrief({
    rowData: params.productData,
    imageCount: policy.imageCount,
    customInstruction: column?.customInstruction,
    allowedDomains: domainRules.allowedDomains,
    blockedDomains: domainRules.blockedDomains,
  });

  // Trust any real link the model reports — from a search result or read
  // directly off a page it opened and confirmed — rather than requiring an
  // exact match against a separate image-search field. The safety net is no
  // longer "which tool did this come from" but "does it actually load as an
  // image", checked for real below. Confidence only ever annotates a
  // caption; it never removes a candidate.
  const parse: EnrichResponseParser = async ({ selection }) => {
    const rawImages = Array.isArray(selection.images) ? selection.images : [];
    const confidenceByUrl = new Map<string, { confidence: string; matchedOn: string }>();
    const candidates: Array<{ imageUrl: string; pageUrl: string; title: string }> = [];
    const seen = new Set<string>();
    for (const item of rawImages) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const url = String(record.url ?? "").trim();
      if (!url || !/^https:\/\//i.test(url)) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const pageUrl = String(record.pageUrl ?? "")
        .trim()
        .replace(/(\/products\/[^/?#]+)\.json/i, "$1");
      candidates.push({
        imageUrl: url,
        pageUrl: /^https:\/\//i.test(pageUrl) ? pageUrl : url,
        title: "Product image",
      });
      confidenceByUrl.set(key, {
        confidence: String(record.confidence ?? "").trim(),
        matchedOn: String(record.matchedOn ?? "").trim(),
      });
    }

    const withinRules = filterImagesByDomainRules(candidates, domainRules);
    const verified = await verifyImageUrls(withinRules.map((c) => c.imageUrl));
    const images = withinRules
      .filter((c) => verified.has(c.imageUrl.toLowerCase()))
      .slice(0, brief.imageCount)
      .map((image) => annotateConfidence(image, confidenceByUrl.get(image.imageUrl.toLowerCase())));

    // Always write the reason key so a later successful run clears a stale
    // one from an earlier empty run — never leave the grid showing a
    // "Not found" reason that no longer reflects the current result.
    const notes = typeof selection.notes === "string" ? selection.notes.trim() : "";
    return {
      [IMAGE_COLUMN_ID]: images,
      [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: images.length === 0 ? notes : "",
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
    // Cast a wide net per search call; the schema above still caps the final
    // answer at brief.imageCount, so this only gives the model more real
    // candidates to be confident about, never more images than requested.
    imageSearchPoolSize: imageFinderCandidatePoolSize(brief.imageCount),
    // Back to the shared tier default (medium/high) — a live URL-loads check
    // plus a simpler, more direct skill closed the accuracy gap that xhigh
    // was compensating for, so the extra reasoning cost is no longer needed.
    unlimitedSearchContentBudget: true,
    shouldCancel: params.shouldCancel,
  });

  return { data: result.data, costs: result.costs };
}
