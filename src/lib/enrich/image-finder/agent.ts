import {
  PRODUCT_MODE_COLUMN_IDS,
  resolveEnrichmentModel,
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

function imageFinderSchema(imageCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      [IMAGE_COLUMN_ID]: {
        type: "array",
        description:
          "image_url values copied exactly from web_search image_result items, best first. Only images of this exact product.",
        items: { type: "string" },
        maxItems: imageCount,
      },
      notes: {
        type: "string",
        description:
          "One or two short sentences: which identifiers were trusted, which were set aside as unreliable and why, and why any candidates were rejected or the list is shorter than requested.",
      },
    },
    required: [IMAGE_COLUMN_ID, "notes"],
  };
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
  // pass the website rules; no padding with unvetted candidates.
  const parse: EnrichResponseParser = ({ selection, response }) => {
    const images = pickImagesFromSelection(
      selection[IMAGE_COLUMN_ID],
      filterImagesByDomainRules(collectToolImages(response), domainRules),
      brief.imageCount,
      { pad: false }
    );
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
  });

  return { data: result.data, costs: result.costs };
}
