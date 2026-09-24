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
import { collectToolImages, pickImagesFromSelection } from "../tool-results";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { buildImageFinderBrief } from "./brief";
import { imageFinderNotFoundKey } from "./not-found";
import { imageFinderCandidatePoolSize } from "./pool-size";
import { IMAGE_FINDER_SKILL } from "./skill";

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
                "image_url copied exactly from a web_search image_result item. Never a page URL or an invented URL.",
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
          required: ["url", "confidence", "matchedOn"],
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

  // Keep only images the model approved that exactly match tool results and
  // pass the website rules; no padding with unvetted candidates. Confidence
  // is read separately and only ever annotates a caption — it never removes
  // a candidate, so a low-confidence match is still returned, just labeled.
  const parse: EnrichResponseParser = ({ selection, response }) => {
    const rawImages = Array.isArray(selection.images) ? selection.images : [];
    const confidenceByUrl = new Map<string, { confidence: string; matchedOn: string }>();
    const candidateUrls: string[] = [];
    for (const item of rawImages) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const url = String(record.url ?? "").trim();
      if (!url) continue;
      candidateUrls.push(url);
      confidenceByUrl.set(url.toLowerCase(), {
        confidence: String(record.confidence ?? "").trim(),
        matchedOn: String(record.matchedOn ?? "").trim(),
      });
    }

    const images = pickImagesFromSelection(
      candidateUrls,
      filterImagesByDomainRules(collectToolImages(response), domainRules),
      brief.imageCount,
      { pad: false }
    ).map((image) => annotateConfidence(image, confidenceByUrl.get(image.imageUrl.toLowerCase())));

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
    // Image identification is the highest-stakes, most search-heavy agent in
    // the app — worth the extra depth and cost on Premium specifically.
    reasoningEffortOverride: tier === "premium" ? "xhigh" : undefined,
    unlimitedSearchContentBudget: true,
    shouldCancel: params.shouldCancel,
  });

  return { data: result.data, costs: result.costs };
}
