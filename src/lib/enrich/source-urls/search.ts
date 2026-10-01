/**
 * Source URLs orchestration: one Google AI Mode search for the exact product
 * and — only when that produced no usable page — one automatic second try with
 * different search angles (see ./skill.ts). Every SearchApi call that returned
 * HTTP 200 is billed, so each is added to `costs` the moment it returns —
 * before its answer is read — and an unreadable answer can never lose the
 * charge.
 *
 * Every page that is returned passes the code-side checks the Image Finder's
 * Exact Match uses (a full product URL, not a search engine, social or
 * reference site), plus a listing-page filter. The answer is also compared with
 * the pages Google itself cited (`reference_links`): a page Google cited is
 * real by construction, so those are ranked first.
 *
 * A failed call on attempt 1 (bad key, network, non-200) throws as-is —
 * nothing was billed. A failure on attempt 2 does not throw: attempt 1 already
 * answered, so the result is "none found" with attempt 1's cost and the failure
 * in the note.
 */
import { createSearchApiCost, type AiCallCost } from "@/lib/ai-pricing";
import type { SourceUrl } from "@/types";
import { checkExactLinksDetailed, describeRejected } from "../image-finder/exact/links-checks";
import {
  callGoogleAiMode,
  isTransientSearchApiError,
  SearchApiCallError,
  type GoogleAiModeReferenceLink,
} from "../image-finder/exact/searchapi";
import { EnrichBilledAttemptError, EnrichCancelledError } from "../openai";
import {
  buildSourceUrlsQuery,
  cleanPageTitle,
  harvestSourceCandidates,
  parseBestSourceAnswer,
  SOURCE_URLS_MAX,
  type SourceCandidate,
  type SourceUrlsAttempt,
} from "./skill";

export interface SearchSourceUrlsInput {
  rowData: Record<string, string>;
  customInstruction?: string;
  /** One public http(s) photo of the item for Google to look at; omit when the row has none. */
  imageUrl?: string;
  shouldCancel?: () => Promise<boolean>;
  /** Wait before the one retry of a rate-limited or 5xx call (tests shorten it). */
  retryDelayMs?: number;
}

const TRANSIENT_RETRY_DELAY_MS = 2_000;

export interface SearchSourceUrlsResult {
  sources: SourceUrl[];
  /** One SearchApi cost per Google AI Mode call that ran. */
  costs: AiCallCost[];
  /** Number of searches that answered (1 or 2). */
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
  retryDelayMs: number
): Promise<{ call: Awaited<ReturnType<typeof callGoogleAiMode>>; usedImage: boolean }> {
  const once = async (query: string, image?: string) => {
    try {
      const call = await callGoogleAiMode(query, image ? { imageUrl: image } : {});
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

async function runAttempt(
  input: SearchSourceUrlsInput,
  attempt: SourceUrlsAttempt,
  costs: AiCallCost[]
): Promise<AttemptOutcome> {
  const imageUrl = input.imageUrl && /^https?:\/\//i.test(input.imageUrl) ? input.imageUrl : undefined;
  const buildQuery = (hasImage: boolean) =>
    buildSourceUrlsQuery({
      rowData: input.rowData,
      customInstruction: input.customInstruction,
      hasImage,
      attempt,
    });

  const { call, usedImage } = await askGoogle(buildQuery, imageUrl, costs, input.retryDelayMs ?? TRANSIENT_RETRY_DELAY_MS);

  let answer = parseBestSourceAnswer(call.texts);
  let harvested = false;
  if (!answer.readable) {
    // No JSON we can read (typically Google answering with its own list of web
    // results): use the links in that answer rather than call it "none found".
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
  const sources = rankSources(
    links
      .filter((link) => !looksLikeListingPage(link.url))
      .map((link) => ({ url: link.url, title: titles.get(link.url.toLowerCase()) })),
    call.referenceLinks
  );

  console.log("[Source URLs] Google AI Mode call", {
    attempt,
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
  const why = describeRejected(rejected);
  return {
    sources: [],
    summary: `returned ${candidates.length} page(s), all rejected${why ? `: ${why}` : ""}`,
    usedImage,
  };
}

export async function searchSourceUrls(input: SearchSourceUrlsInput): Promise<SearchSourceUrlsResult> {
  const costs: AiCallCost[] = [];

  let first: AttemptOutcome;
  try {
    first = await runAttempt(input, 1, costs);
  } catch (error) {
    if (costs.length > 0) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EnrichBilledAttemptError(message, costs);
    }
    throw error;
  }
  if (first.sources.length > 0) {
    return { sources: first.sources, costs, attempts: 1, usedImage: first.usedImage, notFoundReason: "" };
  }

  if (input.shouldCancel && (await input.shouldCancel().catch(() => false))) {
    throw new EnrichCancelledError("Cancelled before the second Google AI Mode search.", costs);
  }

  // The first search answered, so a failure of the second must not turn the
  // row into an error: it stays "none found", with the failure in the note.
  let second: AttemptOutcome;
  try {
    second = await runAttempt(input, 2, costs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sources: [],
      costs,
      attempts: 2,
      usedImage: first.usedImage,
      notFoundReason: `Google AI Mode found no page for this item (search 1: ${first.summary}; search 2 failed: ${message.slice(0, 200)}).`,
    };
  }
  if (second.sources.length > 0) {
    return { sources: second.sources, costs, attempts: 2, usedImage: second.usedImage, notFoundReason: "" };
  }
  return {
    sources: [],
    costs,
    attempts: 2,
    usedImage: second.usedImage,
    notFoundReason: `Google AI Mode found no page for this item (search 1: ${first.summary}; search 2: ${second.summary}).`,
  };
}
