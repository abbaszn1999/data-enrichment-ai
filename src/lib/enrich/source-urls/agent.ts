/**
 * Source URLs agent: fills the "Source URLs" output column (switched on in the
 * "Source & Image Finder" tab, alone or next to Images) with the web pages for
 * the exact product, using one Google AI Mode search (SearchApi) instead of an
 * OpenAI call. It is a small agent with a tiny fixed
 * prompt (./skill.ts): the product from the row's source columns, the column's
 * custom instruction when there is one, and one photo of the item when image
 * columns are selected. There is no page count. Two optional settings narrow
 * the search: a Website (one to three sites searched for the item's page, see ./site.ts)
 * and a Market (the country the search runs from, see ./markets.ts). With
 * neither, the search is the open one, unchanged.
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
import { searchSourceUrls } from "./search";
import { siteDomainsOf } from "./site";

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

  // Website mode and the market are the column's own settings. The values come
  // from the browser, so they are re-checked here: anything that is not a
  // website means the open search, and the market must be one on the list.
  const domains = siteDomainsOf(column?.sourceWebsite);
  const website = domains.length > 0 ? domains.join(", ") : undefined;
  const { market } = resolveSearchMarket(column?.sourceMarket, website);

  const result = await searchSourceUrls({
    rowData: params.productData,
    customInstruction: column?.customInstruction,
    website,
    location: market?.name,
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
