import { IMAGE_SOURCES_COLUMN_ID, PRODUCT_MODE_COLUMN_IDS, type SessionKind } from "@/types";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { findProductImagesAuto } from "./pipeline";

export { IMAGE_FINDER_ATTEMPT_BUDGET_MS, IMAGE_FINDER_MAX_ROUNDS } from "./premium-agent";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;
/**
 * Image Finder sends the product image column, optionally with its companion
 * Image sources column (filled by the same run). Anything else is a regular
 * enrichment run.
 */
export function isImageFinderRun(
  kind: SessionKind,
  enabledColumns: string[]
): boolean {
  return (
    kind === "product" &&
    enabledColumns.includes(IMAGE_COLUMN_ID) &&
    enabledColumns.every((id) => id === IMAGE_COLUMN_ID || id === IMAGE_SOURCES_COLUMN_ID)
  );
}

/**
 * Image Finder entry point for one row. There is no tier setting: the row
 * runs Standard, then Exact Match, then Premium, and the first tier that
 * returns verified images wins (pipeline.ts). All tiers share the Responses
 * transport and cost calculation with the enrichment agent, and the row is
 * charged once for everything that ran.
 */
export async function findProductImages(
  params: EnrichAgentParams
): Promise<EnrichAgentResult> {
  return findProductImagesAuto(params);
}
