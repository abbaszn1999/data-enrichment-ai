/**
 * Lens agent: fills the "Lens founds" column (the Lens switch of the "Source &
 * Image Finder" tab) with the pages Google Lens matched to the row's picture.
 * No model is involved: one SearchApi Google Lens search per row (a second one
 * only when the owner asked for similar matches and the exact ones fall short),
 * then the owner's website rules, de-duplication and the page limit.
 *
 * Every search SearchApi answered with HTTP 200 is billed, found pages or not,
 * so each is added to `costs` the moment it returns and a later failure can
 * never lose the charge. A failure before any billed search throws as-is
 * (nothing was charged); a failure after one throws with the costs attached.
 */
import { createSearchApiCost, SEARCHAPI_GOOGLE_LENS_MODEL, type AiCallCost } from "@/lib/ai-pricing";
import { hideProviderNames } from "@/lib/provider-names";
import { LENS_FOUNDS_COLUMN_ID, type LensMatchScope, type SourceUrl } from "@/types";
import { hostMatchesDomain, sanitizeDomainRules, type DomainRules } from "../domains";
import { imageFinderNotFoundKey } from "../image-finder/not-found";
import { isTransientSearchApiError, SearchApiCallError } from "../image-finder/exact/searchapi";
import { EnrichBilledAttemptError, EnrichCancelledError } from "../openai";
import { cleanPageTitle } from "../source-urls/skill";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { classifyLensLink } from "./product-links";
import { callGoogleLens, type LensMatch, type LensSearchType } from "./searchapi-lens";

export const LENS_PAGES_DEFAULT = 10;
export const LENS_PAGES_MAX = 20;

const TRANSIENT_RETRY_DELAY_MS = 2_000;

export interface FindLensMatchesInput {
  /** One public http(s) link to the picture. Omit when the row has none. */
  imageUrl?: string;
  scope: LensMatchScope;
  limit: number;
  rules: DomainRules;
  /** Keep only pages that look like product pages, best first. Default on. */
  productsOnly?: boolean;
  shouldCancel?: () => Promise<boolean>;
  /** Wait before the one retry of a rate-limited or 5xx call (tests shorten it). */
  retryDelayMs?: number;
}

export interface FindLensMatchesResult {
  sources: SourceUrl[];
  /** One SearchApi cost per Lens search that was billed. */
  costs: AiCallCost[];
  searches: number;
  notFoundReason: string;
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Host plus path without trailing slash; the query and hash do not make a page different. */
function pageKey(raw: string): string {
  try {
    const url = new URL(raw);
    return `${hostOf(raw)}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** How many listed pages were set aside, and why. */
export interface LensDrops {
  /** Video, social, reference and stock-photo websites. */
  site: number;
  /** Category, review, article and search pages. */
  listing: number;
  /** Home pages and files that are not a page about one product. */
  notPage: number;
  /** Blocked or not allowed by the owner's website rules. */
  rules: number;
}

export const emptyLensDrops = (): LensDrops => ({ site: 0, listing: 0, notPage: 0, rules: 0 });

interface ToLensSourcesOptions {
  /** Drop what is clearly not a product page and list product-looking pages first. Default on. */
  productsOnly?: boolean;
  drops?: LensDrops;
}

/**
 * Lens matches as Source URLs: only websites the rules allow, no repeated page,
 * cut at `limit`. With `productsOnly`, pages that are clearly not about one
 * product are dropped and the rest are ordered priced pages, then product-looking
 * URLs, then the unknown ones (Google's order kept inside each group). `seen`
 * carries the pages already kept so a second list continues the first.
 */
export function toLensSources(
  matches: LensMatch[],
  rules: DomainRules,
  limit: number,
  seen: Set<string> = new Set(),
  kept: SourceUrl[] = [],
  options: ToLensSourcesOptions = {}
): SourceUrl[] {
  const productsOnly = options.productsOnly !== false;
  const drops = options.drops;
  const candidates: Array<{ match: LensMatch; key: string; host: string; tier: number }> = [];
  const listed = new Set<string>();

  for (const match of matches) {
    const host = hostOf(match.link);
    if (!host) continue;
    if (
      rules.blockedDomains.some((domain) => hostMatchesDomain(host, domain)) ||
      (rules.allowedDomains.length > 0 && !rules.allowedDomains.some((domain) => hostMatchesDomain(host, domain)))
    ) {
      if (drops) drops.rules += 1;
      continue;
    }
    let tier = 2;
    if (productsOnly) {
      const verdict = classifyLensLink(match);
      if (verdict.drop) {
        if (drops) {
          if (verdict.drop === "site") drops.site += 1;
          else if (verdict.drop === "listing") drops.listing += 1;
          else drops.notPage += 1;
        }
        continue;
      }
      tier = verdict.tier;
    }
    const key = pageKey(match.link);
    if (seen.has(key) || listed.has(key)) continue;
    listed.add(key);
    candidates.push({ match, key, host, tier });
  }

  if (productsOnly) candidates.sort((a, b) => a.tier - b.tier);
  for (const { match, key, host } of candidates) {
    if (kept.length >= limit) break;
    seen.add(key);
    kept.push({ title: cleanPageTitle(match.title) || match.source || host, uri: match.link });
  }
  return kept;
}

/** "5 on video, social or reference sites, 3 category or review pages" — empty when nothing was set aside. */
export function describeLensDrops(drops: LensDrops): string {
  const parts: string[] = [];
  if (drops.site > 0) parts.push(`${drops.site} on video, social, reference or stock-photo sites`);
  if (drops.listing > 0) parts.push(`${drops.listing} category, review or article page(s)`);
  if (drops.notPage > 0) parts.push(`${drops.notPage} home page(s) or file(s)`);
  if (drops.rules > 0) parts.push(`${drops.rules} blocked by your website rules`);
  return parts.join(", ");
}

export async function searchLensMatches(input: FindLensMatchesInput): Promise<FindLensMatchesResult> {
  const costs: AiCallCost[] = [];
  const imageUrl = input.imageUrl && /^https?:\/\//i.test(input.imageUrl) ? input.imageUrl : undefined;
  if (!imageUrl) {
    return {
      sources: [],
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

  const seen = new Set<string>();
  const sources: SourceUrl[] = [];
  const drops = emptyLensDrops();
  const listOptions = { productsOnly: input.productsOnly !== false, drops };
  let exactListed = 0;
  let visualListed = 0;
  let visualNote = "";

  try {
    const first = await run(input.scope === "products" ? "products" : "exact_matches");
    exactListed = first.matches.length;
    toLensSources(first.matches, input.rules, input.limit, seen, sources, listOptions);
  } catch (error) {
    if (costs.length > 0) {
      throw new EnrichBilledAttemptError(error instanceof Error ? error.message : String(error), costs);
    }
    throw error;
  }

  if (input.scope === "exact_and_visual" && sources.length < input.limit) {
    if (input.shouldCancel && (await input.shouldCancel().catch(() => false))) {
      throw new EnrichCancelledError("Cancelled before the similar-pictures search.", costs);
    }
    // The exact search answered, so a failure here must not turn the row into
    // an error: it keeps the exact pages and carries the failure in a note.
    try {
      const visual = await run("visual_matches");
      visualListed = visual.matches.length;
      toLensSources(visual.matches, input.rules, input.limit, seen, sources, listOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      visualNote = ` (the similar-pictures search failed: ${hideProviderNames(message.slice(0, 200))})`;
    }
  }

  console.log("[Lens] Google Lens search", {
    searches: costs.length,
    exactListed,
    visualListed,
    kept: sources.length,
    drops,
  });

  if (sources.length > 0) return { sources, costs, searches: costs.length, notFoundReason: "" };

  const listed = exactListed + visualListed;
  const why = describeLensDrops(drops);
  const reason =
    listed === 0
      ? "Google Lens found no page for this picture."
      : `Google Lens found ${listed} page(s), but none is a product page you allow${why ? `: ${why}` : ""}.`;
  return { sources: [], costs, searches: costs.length, notFoundReason: `${reason}${visualNote}` };
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
    shouldCancel: params.shouldCancel,
  });

  return {
    data: {
      [LENS_FOUNDS_COLUMN_ID]: result.sources,
      // Cleared on success so a re-run does not keep an old "Not found" note.
      [imageFinderNotFoundKey(LENS_FOUNDS_COLUMN_ID)]: result.sources.length > 0 ? "" : result.notFoundReason,
    },
    costs: result.costs,
  };
}
