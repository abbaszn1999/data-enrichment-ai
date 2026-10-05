/**
 * Lens agent: fills the "Lens founds" column (the Lens switch of the "Source &
 * Image Finder" tab) with the pages Google Lens matched to the row's picture.
 * No model is involved: one SearchApi Google Lens search per row (a second one
 * only when the owner asked for similar matches and the exact ones fall short),
 * then the owner's website rules and the product-page selection (select.ts).
 *
 * Every search SearchApi answered with HTTP 200 is billed, found pages or not,
 * so each is added to `costs` the moment it returns and a later failure can
 * never lose the charge. A failure before any billed search throws as-is
 * (nothing was charged); a failure after one throws with the costs attached.
 */
import { createSearchApiCost, SEARCHAPI_GOOGLE_LENS_MODEL, type AiCallCost } from "@/lib/ai-pricing";
import { hideProviderNames } from "@/lib/provider-names";
import { LENS_FOUNDS_COLUMN_ID, type LensMatchScope, type SourceUrl } from "@/types";
import { sanitizeDomainRules, type DomainRules } from "../domains";
import { imageFinderNotFoundKey } from "../image-finder/not-found";
import { isTransientSearchApiError, SearchApiCallError } from "../image-finder/exact/searchapi";
import { EnrichBilledAttemptError, EnrichCancelledError } from "../openai";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { buildLensRowContext, type LensRowContext } from "./product-links";
import { callGoogleLens, type LensSearchType } from "./searchapi-lens";
import { describeLensDrops, newLensSelection, selectLensPages } from "./select";
import { lensAlsoFoundKey, lensSetAsideKey, type LensSetAside } from "./side-keys";

export const LENS_PAGES_DEFAULT = 10;
export const LENS_PAGES_MAX = 20;

const TRANSIENT_RETRY_DELAY_MS = 2_000;

export interface FindLensMatchesInput {
  /** One public http(s) link to the picture. Omit when the row has none. */
  imageUrl?: string;
  scope: LensMatchScope;
  limit: number;
  rules: DomainRules;
  /** Keep only pages that look like product pages, best first, two per website. Default on. */
  productsOnly?: boolean;
  /** What the row says about its item; pages whose title shares it rank higher. */
  row?: LensRowContext;
  shouldCancel?: () => Promise<boolean>;
  /** Wait before the one retry of a rate-limited or 5xx call (tests shorten it). */
  retryDelayMs?: number;
}

export interface FindLensMatchesResult {
  /** The kept pages: what other columns use. */
  sources: SourceUrl[];
  /** Good pages that did not fit the limit, for review. */
  alsoFound: SourceUrl[];
  /** Pages removed as not a product page, with the reason. */
  setAside: LensSetAside[];
  /** One SearchApi cost per Lens search that was billed. */
  costs: AiCallCost[];
  searches: number;
  notFoundReason: string;
}

export async function searchLensMatches(input: FindLensMatchesInput): Promise<FindLensMatchesResult> {
  const costs: AiCallCost[] = [];
  const imageUrl = input.imageUrl && /^https?:\/\//i.test(input.imageUrl) ? input.imageUrl : undefined;
  if (!imageUrl) {
    return {
      sources: [],
      alsoFound: [],
      setAside: [],
      costs,
      searches: 0,
      notFoundReason: "This row has no picture in the Lens image column, so nothing was searched.",
    };
  }
  const retryDelayMs = input.retryDelayMs ?? TRANSIENT_RETRY_DELAY_MS;

  const once = async (searchType: LensSearchType) => {
    try {
      const call = await callGoogleLens(imageUrl, searchType);
      costs.push(createSearchApiCost(1, SEARCHAPI_GOOGLE_LENS_MODEL));
      return call;
    } catch (error) {
      // A billed failure keeps its charge even though there is no answer.
      if (error instanceof SearchApiCallError && error.billed) {
        costs.push(createSearchApiCost(1, SEARCHAPI_GOOGLE_LENS_MODEL));
      }
      throw error;
    }
  };
  // Many rows search at once; a rate limit or a brief outage (never billed)
  // gets one more try instead of failing the row.
  const run = async (searchType: LensSearchType) => {
    try {
      return await once(searchType);
    } catch (error) {
      if (!isTransientSearchApiError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      return once(searchType);
    }
  };

  const selection = newLensSelection();
  const selectOptions = {
    rules: input.rules,
    limit: input.limit,
    productsOnly: input.productsOnly !== false,
    row: input.row,
  };
  let firstListed = 0;
  let visualListed = 0;
  let visualNote = "";

  try {
    const first = await run(input.scope === "products" ? "products" : "exact_matches");
    firstListed = first.matches.length;
    selectLensPages(first.matches, selection, selectOptions);
  } catch (error) {
    if (costs.length > 0) {
      throw new EnrichBilledAttemptError(error instanceof Error ? error.message : String(error), costs);
    }
    throw error;
  }

  if (input.scope === "exact_and_visual" && selection.kept.length < input.limit) {
    if (input.shouldCancel && (await input.shouldCancel().catch(() => false))) {
      throw new EnrichCancelledError("Cancelled before the similar-pictures search.", costs);
    }
    // The exact search answered, so a failure here must not turn the row into
    // an error: it keeps the exact pages and carries the failure in a note.
    try {
      const visual = await run("visual_matches");
      visualListed = visual.matches.length;
      selectLensPages(visual.matches, selection, selectOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      visualNote = ` (the similar-pictures search failed: ${hideProviderNames(message.slice(0, 200))})`;
    }
  }

  console.log("[Lens] Google Lens search", {
    searches: costs.length,
    listed: firstListed + visualListed,
    kept: selection.kept.length,
    alsoFound: selection.alsoFound.length,
    drops: selection.drops,
  });

  const base = {
    alsoFound: selection.alsoFound,
    setAside: selection.setAside,
    costs,
    searches: costs.length,
  };
  if (selection.kept.length > 0) return { sources: selection.kept, ...base, notFoundReason: "" };

  const listed = firstListed + visualListed;
  const why = describeLensDrops(selection.drops);
  const reason =
    listed === 0
      ? "Google Lens found no page for this picture."
      : `Google Lens found ${listed} page(s), but none is a product page you allow${why ? `: ${why}` : ""}.`;
  return { sources: [], ...base, notFoundReason: `${reason}${visualNote}` };
}

/** The pages Lens found for the row's picture, written to the Lens founds column. */
export async function findLensMatches(params: EnrichAgentParams): Promise<EnrichAgentResult> {
  const column = params.enrichmentColumns?.find((c) => c.id === LENS_FOUNDS_COLUMN_ID);
  const limit = Math.min(Math.max(Math.round(column?.sourceCount ?? LENS_PAGES_DEFAULT), 1), LENS_PAGES_MAX);

  const result = await searchLensMatches({
    imageUrl: (params.sourceImageUrls ?? []).find((url) => /^https?:\/\//i.test(url)),
    scope:
      column?.lensMatchScope === "exact_and_visual" || column?.lensMatchScope === "products"
        ? column.lensMatchScope
        : "exact",
    productsOnly: column?.lensProductPagesOnly !== false,
    limit,
    rules: sanitizeDomainRules({ allowedDomains: column?.allowedDomains, blockedDomains: column?.blockedDomains }),
    row: buildLensRowContext(params.productData),
    shouldCancel: params.shouldCancel,
  });

  return {
    data: {
      [LENS_FOUNDS_COLUMN_ID]: result.sources,
      // Always written so a re-run replaces the old lists instead of mixing with them.
      [lensAlsoFoundKey(LENS_FOUNDS_COLUMN_ID)]: result.alsoFound,
      [lensSetAsideKey(LENS_FOUNDS_COLUMN_ID)]: result.setAside,
      [imageFinderNotFoundKey(LENS_FOUNDS_COLUMN_ID)]: result.sources.length > 0 ? "" : result.notFoundReason,
    },
    costs: result.costs,
  };
}
