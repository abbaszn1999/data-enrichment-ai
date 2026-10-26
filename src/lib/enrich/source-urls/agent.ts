/**
 * Source URLs agent: fills the "Source URLs" output column (switched on in the
 * "Source & Image Finder" tab, alone or next to Images) with the web pages for
 * the exact product, using Google AI Mode searches (SearchApi) instead of an
 * OpenAI call. It is a small agent with a tiny fixed
 * prompt (./skill.ts): the product from the row's source columns, the column's
 * custom instruction when there is one (where the owner says what to search by,
 * in what order and on which websites), and one photo of the item when image
 * columns are selected. There is no page count. A row that finds nothing is
 * searched again with the same query (./search.ts). One optional setting
 * narrows the search: a Market (the country the search runs from, see
 * ./markets.ts), sent as the search location.
 *
 * Only the column with the id `sourceUrls` runs here. Image Finder's "Image
 * sources" column also has the type `sourceUrls` but a different id
 * (`imageSourceUrls`); it is written by the Image Finder itself and must never
 * be routed to this agent, so the match is by id, never by type.
 */
import { SOURCE_URLS_COLUMN_ID, type SessionKind } from "@/types";
import { imageFinderNotFoundKey } from "../image-finder/not-found";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { resolveSearchMarket } from "./markets";
import { readStoredPlan } from "./plan";
import { searchSourceUrls } from "./search";

/**
 * Starts the note of a Source URLs cell left empty because the search could not
 * run at all (the app's own setup, see search.ts), as opposed to a "Not found"
 * on this item. Such a row is not retried automatically: the cause is not the item.
 */
export const SOURCE_URLS_SETUP_FAILURE_NOTE = "The web search failed, so no pages were found.";

/** Whether this run's Source URLs column is answered by Google AI Mode. Product sheets only; PLP keeps its own flow. */
export function usesGoogleSourceUrls(kind: SessionKind, enabledColumns: string[]): boolean {
  return kind === "product" && enabledColumns.includes(SOURCE_URLS_COLUMN_ID);
}

/** The first photo among the selected image columns that Google can fetch. */
function firstPublicImage(urls: string[] | undefined): string | undefined {
  return (urls ?? []).find((url) => /^https?:\/\//i.test(url));
}

export async function findSourceUrls(params: EnrichAgentParams): Promise<EnrichAgentResult> {
  const column = params.enrichmentColumns?.find((c) => c.id === SOURCE_URLS_COLUMN_ID);

  // The market is the column's own setting. The value comes from the browser,
  // so it is re-checked here: it must be a country on the list, or no location.
  const market = resolveSearchMarket(column?.sourceMarket);

  const result = await searchSourceUrls({
    rowData: params.productData,
    customInstruction: column?.customInstruction,
    location: market?.name,
    // Checked again here: the plan comes from the job's saved settings.
    plan: readStoredPlan(params.sourceUrlsPlan),
    imageUrl: firstPublicImage(params.sourceImageUrls),
    shouldCancel: params.shouldCancel,
  });

  return {
    data: {
      [SOURCE_URLS_COLUMN_ID]: result.sources,
      // Cleared on success so a re-run does not keep an old "Not found" note.
      [imageFinderNotFoundKey(SOURCE_URLS_COLUMN_ID)]: result.sources.length > 0 ? "" : result.notFoundReason,
    },
    costs: result.costs,
  };
}
