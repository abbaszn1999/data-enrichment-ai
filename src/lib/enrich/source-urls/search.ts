/**
 * Source URLs orchestration: Google AI Mode searches for the exact product. A
 * row that finds no usable page is searched AGAIN, up to SOURCE_URLS_MAX_TRIES
 * searches in total. Google AI Mode does not answer the same question the same
 * way twice, so repeating a search recovers rows that a single search missed;
 * rewording a retry did not do better. Without a plan the retries are exactly
 * the same query (see ./skill.ts); with the run's plan (./plan.ts) they are the
 * plan's requests, which differ by what they search with, not by wording.
 *
 * Every SearchApi call that returned HTTP 200 is billed, so each is added to
 * `costs` the moment it returns — before its answer is read — and an
 * unreadable answer can never lose the charge.
 *
 * Every page that is returned passes the code-side checks the Image Finder's
 * Exact Match uses (a full product URL, not a search engine, social or
 * reference site), plus a listing-page filter. When the answer itself names no
 * page, the pages Google cited (`reference_links`) are used: a cited page is
 * real by construction, and Google sometimes names only the home page in its
 * text while citing the product page. Cited pages are ranked first.
 *
 * With a plan (./plan.ts) the tries are the plan's requests filled in for the
 * row, in order, going round again when there are fewer than five; without one
 * every try asks the same default query.
 *
 * A failed call on the first search (bad key, network, non-200) throws as-is —
 * nothing was billed. A failure on a later search does not throw: an earlier
 * one already answered, so the result is "none found" with the costs so far and
 * the failure in the note.
 */
import { createSearchApiCost, type AiCallCost } from "@/lib/ai-pricing";
import { hideProviderNames } from "@/lib/provider-names";
import type { SourceUrl } from "@/types";
import { checkExactLinksDetailed, describeRejected } from "../image-finder/exact/links-checks";
import {
  callGoogleAiMode,
  isTransientSearchApiError,
  SearchApiCallError,
  type GoogleAiModeReferenceLink,
} from "../image-finder/exact/searchapi";
import { EnrichBilledAttemptError, EnrichCancelledError } from "../openai";
import { expandTries, type PlannedTry, type SourceUrlsPlan } from "./plan";
import {
  buildPlannedQuery,
  buildSourceUrlsQuery,
  cleanPageTitle,
  harvestSourceCandidates,
  parseBestSourceAnswer,
  SOURCE_URLS_MAX,
  type SourceCandidate,
} from "./skill";

/** Searches per row when the earlier ones found no usable page: the first plus up to 4 identical retries. */
export const SOURCE_URLS_MAX_TRIES = 5;

/**
 * No new search starts after this long on one row, so five slow searches can
 * never run into the job's row time limit (jobs/config.ts) when Image Finder
 * shares the row.
 */
export const SOURCE_URLS_TRIES_BUDGET_MS = 420_000;

export interface SearchSourceUrlsInput {
  rowData: Record<string, string>;
  customInstruction?: string;
  /** One public http(s) photo of the item for Google to look at; omit when the row has none. */
  imageUrl?: string;
  /** Country to search from, as a place name ("United Kingdom"); sent as the search location, never in the prompt. */
  location?: string;
  /**
   * The run's plan (./plan.ts): the requests written once from the custom
   * instruction. Without one, every try asks today's single query.
   */
  plan?: SourceUrlsPlan;
  shouldCancel?: () => Promise<boolean>;
  /** Wait before the one retry of a rate-limited or 5xx call (tests shorten it). */
  retryDelayMs?: number;
  /** Searches per row, first one included (tests and callers may lower it). Defaults to SOURCE_URLS_MAX_TRIES. */
  maxTries?: number;
}

const TRANSIENT_RETRY_DELAY_MS = 2_000;

export interface SearchSourceUrlsResult {
  sources: SourceUrl[];
  /** One SearchApi cost per Google AI Mode call that ran. */
  costs: AiCallCost[];
  /** Number of searches that answered (1 up to the maximum). */
  attempts: number;
  /** Whether a photo was sent with the search that produced the result. */
  usedImage: boolean;
  /** Human-readable explanation, set when `sources` is empty. */
  notFoundReason: string;
}

interface AttemptOutcome {
  sources: SourceUrl[];
  summary: string;
  usedImage: boolean;
}

/** Host without `www.` plus path without trailing slash; query and hash dropped. */
export function pageKey(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

/**
 * Shop pages that list many products or a brand's whole store rather than the
 * one item: Amazon storefronts and landing pages, and on-site search results.
 */
export function looksLikeListingPage(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (/(^|\.)amazon\.[a-z.]+$/.test(host)) {
      if (/^\/(stores|clp|b|gp\/browse|s)(\/|$)/i.test(url.pathname)) return true;
      // Search pages with a name in front: /some-product-name/s?k=...
      if (/\/s\/?$/i.test(url.pathname) && url.searchParams.has("k")) return true;
    }
    if (/(^|\.)walmart\.[a-z.]+$/.test(host) && /^\/(c|cp|browse)(\/|$)/i.test(url.pathname)) return true;
    if (/^\/(search|s|catalogsearch)(\/|$)/i.test(url.pathname)) return true;
    return url.searchParams.has("q") && /search/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Pages Google cited, by pageKey, with their titles. */
function citedPages(referenceLinks: GoogleAiModeReferenceLink[]): Map<string, string | undefined> {
  const cited = new Map<string, string | undefined>();
  for (const ref of referenceLinks) {
    const key = pageKey(ref.link);
    if (!cited.has(key)) cited.set(key, ref.title?.trim() || undefined);
  }
  return cited;
}

/**
 * Orders the pages that passed the checks, best first, and cuts the list at the
 * safety cap. Pages Google itself cited come first (and lend their real page
 * title) because a cited page is real by construction; the others follow in the
 * order Google listed them, so a row can still get every source it found.
 */
export function rankSources(
  checked: Array<{ url: string; title?: string }>,
  referenceLinks: GoogleAiModeReferenceLink[],
  limit: number = SOURCE_URLS_MAX
): SourceUrl[] {
  const cited = citedPages(referenceLinks);
  const toSource = (link: { url: string; title?: string }): SourceUrl => ({
    title: cleanPageTitle(cited.get(pageKey(link.url)) ?? link.title) || hostOf(link.url),
    uri: link.url,
  });
  const grounded = checked.filter((link) => cited.has(pageKey(link.url)));
  const rest = checked.filter((link) => !cited.has(pageKey(link.url)));
  return [...grounded, ...rest].slice(0, limit).map(toSource);
}

/**
 * One Google AI Mode call. With a photo it tries the photo first; if that call
 * fails (the photo may be unreachable for Google) it retries once without it,
 * because the text search still stands. The prompt mentions the photo only when
 * it is really sent. Each billed call is added to `costs` right away, before
 * its answer is read, so an unreadable answer can never lose the charge.
 */
async function askGoogle(
  buildQuery: (hasImage: boolean) => string,
  imageUrl: string | undefined,
  costs: AiCallCost[],
  retryDelayMs: number,
  location?: string
): Promise<{ call: Awaited<ReturnType<typeof callGoogleAiMode>>; usedImage: boolean }> {
  const once = async (query: string, image?: string) => {
    try {
      const call = await callGoogleAiMode(query, {
        ...(image ? { imageUrl: image } : {}),
        ...(location ? { location } : {}),
      });
      costs.push(createSearchApiCost(1));
      return call;
    } catch (error) {
      // A billed failure keeps its charge even though there is no answer.
      if (error instanceof SearchApiCallError && error.billed) costs.push(createSearchApiCost(1));
      throw error;
    }
  };
  // Many rows search at once; a rate limit or a brief SearchApi outage (never
  // billed) gets one more try instead of failing the row or emptying the cell.
  const run = async (query: string, image?: string) => {
    try {
      return await once(query, image);
    } catch (error) {
      if (!isTransientSearchApiError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      return once(query, image);
    }
  };
  if (imageUrl) {
    try {
      return { call: await run(buildQuery(true), imageUrl), usedImage: true };
    } catch (error) {
      if (!(error instanceof SearchApiCallError)) throw error;
      console.warn("[Source URLs] Google AI Mode call with the photo failed; retrying without it", {
        message: error.message.slice(0, 200),
      });
    }
  }
  return { call: await run(buildQuery(false)), usedImage: false };
}

/**
 * One search, read and checked. `planned` is this try's request: a plan step
 * filled in for the row, or (no plan, or a row no step fits) today's query.
 */
async function runSearch(
  input: SearchSourceUrlsInput,
  attempt: number,
  costs: AiCallCost[],
  planned: PlannedTry
): Promise<AttemptOutcome> {
  const imageUrl = input.imageUrl && /^https?:\/\//i.test(input.imageUrl) ? input.imageUrl : undefined;
  const buildQuery = (hasImage: boolean) =>
    planned.text !== undefined
      ? buildPlannedQuery({ text: planned.text, hasImage })
      : buildSourceUrlsQuery({
          rowData: input.rowData,
          customInstruction: input.customInstruction,
          hasImage,
        });

  const { call, usedImage } = await askGoogle(
    buildQuery,
    imageUrl,
    costs,
    input.retryDelayMs ?? TRANSIENT_RETRY_DELAY_MS,
    input.location
  );

  let answer = parseBestSourceAnswer(call.texts);
  let harvested = false;
  if (answer.sources.length === 0) {
    // The answer names no page: either no JSON we can read (typically Google
    // answering with its own list of web results) or an answer that names only
    // a home page or nothing at all while Google cites product pages. Those
    // links, in Google's order, still go through the checks below, so they are
    // used instead of reporting "none found".
    const leads = harvestSourceCandidates(
      call.texts,
      call.referenceLinks.map((ref) => ref.link)
    );
    if (leads.length > 0) {
      answer = { result: "FOUND", sources: leads, readable: true };
      harvested = true;
    }
  }
  const candidates: SourceCandidate[] = answer.sources;
  const { links, rejected } = checkExactLinksDetailed(
    candidates.map((c) => ({ url: c.url, site: c.title, matchedOn: c.matchedOn, evidence: c.evidence, differences: c.differences })),
    // No identifiers and no website rules: the prompt asks for no evidence to
    // compare, and Enrichment has no website-rules setting.
    [],
    // Generous cap: listing pages are dropped after the checks, then the safety cap applies.
    SOURCE_URLS_MAX * 2,
    undefined,
    { allowHttp: true }
  );
  const titles = new Map(candidates.map((c) => [c.url.trim().toLowerCase(), c.title]));
  const pages = links.filter((link) => !looksLikeListingPage(link.url));
  const listingPages = links.length - pages.length;
  const sources = rankSources(
    pages.map((link) => ({ url: link.url, title: titles.get(link.url.toLowerCase()) })),
    call.referenceLinks
  );

  console.log("[Source URLs] Google AI Mode call", {
    attempt,
    step: planned.label,
    withPhoto: usedImage,
    httpStatus: call.httpStatus,
    ms: call.elapsedMs,
    readable: answer.readable,
    harvestedFromText: harvested,
    linksListed: candidates.length,
    linksKept: sources.length,
    linksRejected: Object.values(rejected).reduce((sum, count) => sum + (count ?? 0), 0),
    referenceLinks: call.referenceLinks.length,
  });

  if (sources.length > 0) return { sources, summary: "", usedImage };
  if (!answer.readable) return { sources: [], summary: "the answer could not be read", usedImage };
  if (candidates.length === 0) return { sources: [], summary: "returned no pages", usedImage };
  // Every drop is counted, the shop-listing filter included, so a miss never hides what we threw away.
  const why = [describeRejected(rejected), listingPages > 0 ? `${listingPages} a shop listing or search page` : ""]
    .filter(Boolean)
    .join(", ");
  console.warn("[Source URLs] Google returned pages but none were kept", {
    attempt,
    returned: candidates.length,
    rejected,
    listingPages,
  });
  return {
    sources: [],
    summary: `returned ${candidates.length} page(s), all rejected${why ? `: ${why}` : ""}`,
    usedImage,
  };
}

/**
 * "search 1: X; searches 2-5: Y". Searches that ended the same way are joined,
 * so five identical tries read as one line, not five.
 */
export function describeTries(summaries: string[]): string {
  const parts: string[] = [];
  let start = 0;
  while (start < summaries.length) {
    let end = start;
    while (end + 1 < summaries.length && summaries[end + 1] === summaries[start]) end += 1;
    const label = start === end ? `search ${start + 1}` : `searches ${start + 1}-${end + 1}`;
    parts.push(`${label}: ${summaries[start]}`);
    start = end + 1;
  }
  return parts.join("; ");
}

export async function searchSourceUrls(input: SearchSourceUrlsInput): Promise<SearchSourceUrlsResult> {
  const costs: AiCallCost[] = [];
  const maxTries = Math.max(1, Math.min(input.maxTries ?? SOURCE_URLS_MAX_TRIES, SOURCE_URLS_MAX_TRIES));
  const startedAt = Date.now();
  // The requests for this row, in the order they are tried (see expandTries).
  const planned = expandTries(input.plan, input.rowData, maxTries);
  const summaries: string[] = [];
  let usedImage = false;
  let timeLimit = false;

  const missNote = (extra = "") =>
    `The web search found no page for this item (${describeTries(summaries)}${extra}${timeLimit ? "; stopped retrying at the time limit" : ""}).`;

  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    if (attempt > 1) {
      if (input.shouldCancel && (await input.shouldCancel().catch(() => false))) {
        throw new EnrichCancelledError(`Cancelled before Google AI Mode search ${attempt}.`, costs);
      }
      if (Date.now() - startedAt > SOURCE_URLS_TRIES_BUDGET_MS) {
        timeLimit = true;
        break;
      }
    }

    let outcome: AttemptOutcome;
    try {
      outcome = await runSearch(input, attempt, costs, planned[attempt - 1] ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        // Nothing answered yet. Any billed failure keeps its charge.
        if (costs.length > 0) throw new EnrichBilledAttemptError(message, costs);
        throw error;
      }
      // An earlier search answered, so a failure of a later one must not turn
      // the row into an error: it stays "none found", with the failure in the note.
      return {
        sources: [],
        costs,
        attempts: summaries.length,
        usedImage,
        notFoundReason: missNote(`; search ${attempt} failed: ${hideProviderNames(message.slice(0, 200))}`),
      };
    }

    usedImage = outcome.usedImage;
    if (outcome.sources.length > 0) {
      return { sources: outcome.sources, costs, attempts: attempt, usedImage, notFoundReason: "" };
    }
    const label = planned[attempt - 1]?.label;
    summaries.push(label ? `"${label}" ${outcome.summary}` : outcome.summary);
  }

  return {
    sources: [],
    costs,
    attempts: summaries.length,
    usedImage,
    notFoundReason: missNote(),
  };
}
