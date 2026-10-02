import {
  IMAGE_SOURCES_COLUMN_ID,
  PRODUCT_MODE_COLUMN_IDS,
  SOURCE_URLS_COLUMN_ID,
  type ImageUrl,
  type SessionKind,
} from "@/types";
import { EnrichCancelledError } from "../openai";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import {
  imageFinderFoundByKey,
  imageFinderMatchBasisKey,
  imageFinderMatchNoteKey,
  imageFinderNotFoundKey,
} from "./not-found";
import { buildImageSourceUrls } from "./sources";
import { findProductImagesStandard } from "./standard-agent";

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;
const FOUND_BY = "standard";

/**
 * Image Finder sends the product image column, optionally with its companion
 * Image sources column (filled by the same run) and, when the user switched it
 * on in the same "Source & Image Finder" tab, the Source URLs column (found by
 * its own Google AI Mode agent, see ../source-urls). Source URLs alone is not
 * an Image Finder run. Anything else is a regular enrichment run.
 */
export function isImageFinderRun(
  kind: SessionKind,
  enabledColumns: string[]
): boolean {
  return (
    kind === "product" &&
    enabledColumns.includes(IMAGE_COLUMN_ID) &&
    enabledColumns.every(
      (id) => id === IMAGE_COLUMN_ID || id === IMAGE_SOURCES_COLUMN_ID || id === SOURCE_URLS_COLUMN_ID
    )
  );
}

type ImageFinderRunner = (params: EnrichAgentParams) => Promise<EnrichAgentResult>;

function imagesOf(data: Record<string, unknown>): ImageUrl[] {
  const value = data[IMAGE_COLUMN_ID];
  return Array.isArray(value) ? (value as ImageUrl[]) : [];
}

function notFoundData(reason: string): Record<string, unknown> {
  return {
    [IMAGE_COLUMN_ID]: [],
    [IMAGE_SOURCES_COLUMN_ID]: [],
    [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: reason,
    [imageFinderMatchBasisKey(IMAGE_COLUMN_ID)]: "",
    [imageFinderMatchNoteKey(IMAGE_COLUMN_ID)]: "",
    [imageFinderFoundByKey(IMAGE_COLUMN_ID)]: "",
  };
}

/**
 * Image Finder entry point for one row: a single agent call (see
 * standard-agent.ts) that opens the pages of a ticked Source URLs column
 * first and searches further when none of them shows the item. A call that
 * fails throws with the costs it billed, so the row is charged once for
 * everything that ran and is never reported as a false Not found.
 */
export async function findProductImages(
  params: EnrichAgentParams,
  run: ImageFinderRunner = findProductImagesStandard
): Promise<EnrichAgentResult> {
  if (params.shouldCancel && (await params.shouldCancel().catch(() => false))) {
    throw new EnrichCancelledError("Cancelled by user", []);
  }

  const result = await run(params);
  const images = imagesOf(result.data);
  if (images.length > 0) {
    return {
      data: {
        ...result.data,
        [IMAGE_SOURCES_COLUMN_ID]: buildImageSourceUrls(images),
        [imageFinderNotFoundKey(IMAGE_COLUMN_ID)]: "",
        [imageFinderFoundByKey(IMAGE_COLUMN_ID)]: FOUND_BY,
      },
      costs: result.costs,
      meta: { tiersRun: [FOUND_BY], foundBy: FOUND_BY },
    };
  }

  const reason = result.data[imageFinderNotFoundKey(IMAGE_COLUMN_ID)];
  const text = typeof reason === "string" ? reason.trim() : "";
  return {
    data: notFoundData(text || "No images were found for this item."),
    costs: result.costs,
    meta: { tiersRun: [FOUND_BY] },
  };
}
