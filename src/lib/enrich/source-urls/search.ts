/**
 * Source URLs orchestration: Google AI Mode searches for the exact product, in
 * two rounds of at most SOURCE_URLS_MAX_TRIES (five) searches in all.
 *
 * Round 1 sends the strongest request three times AT ONCE. Google AI Mode does
 * not answer the same question the same way twice, so the combined answers
 * hold more pages than one, and a page several answers agree on is the best
 * ranked. If that finds nothing, round 2 sends the other requests together.
 * Without a plan the requests are exactly the default query (see ./skill.ts);
 * with the run's plan (./plan.ts) they are its three requests, which differ by
 * angle, not by wording.
 * * Every SearchApi call that returned HTTP 200 is billed, so each is added to
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
 * A search that fails does not stop the round: the others' answers are used,
 * and the failure is named in the note. When not one search of round 1
 * answers, round 2 still runs (its requests are worded differently, and a
 * failure is often tied to one wording). Only when not one search of the whole
 * row answers does the row fail (and it keeps the charge of any call that was
 * billed). If some search answered, a failure elsewhere leaves the row "none
 * found" with the costs so far.
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
import { linkIsOnWebsites, planRounds, type PlannedTry, type SourceUrlsPlan } from "./plan";
import {
  buildPlannedQuery,
  buildSourceUrlsQuery,
  cleanPageTitle,
  harvestSourceCandidates,
  parseBestSourceAnswer,
  SOURCE_URLS_MAX,
  type SourceCandidate,
} from "./skill";

/** Searches per row in all: 3 at once in round 1, then up to 2 more together in round 2. */
export const SOURCE_URLS_MAX_TRIES = 5;

/**
 * No new search starts after this long on one row, so five slow searches can
 * never run into the job's row time limit (jobs/config.ts) when Image Finder
 * shares the row. The last search to start can itself take up to four
 * 120 s calls (a photo call and its retry, then the same without the photo),
 * so 360 s + 4 x 120 s + the retry pauses stays inside the 900 s limit: a row
 * is never killed with billed searches that nobody charged.
 */
export const SOURCE_URLS_TRIES_BUDGET_MS = 360_000;

/**
 * One Google AI Mode call is given up on after this long. Live calls answer in
 * 7-20 s (the odd one up to a minute); a call that has not answered after 60 s
 * is almost always stuck, and waiting longer only holds the whole row.
 */
export const SOURCE_URLS_CALL_TIMEOUT_MS = 60_000;

/**
 * Once one search of a round has a usable page, the others get this long to
 * finish (their pages are merged in and agreement ranks them); whatever is
 * still waiting then is hung up on, so one slow call never holds the row.
 */
export const SOURCE_URLS_GRACE_MS = 12_000;

/** How often a round that is waiting checks whether the owner pressed Stop. */
export const SOURCE_URLS_CANCEL_POLL_MS = 3_000;

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
  /** How long the other searches of a round may keep going after one has a usable page. Defaults to SOURCE_URLS_GRACE_MS. */
  graceMs?: number;
  /** How often a waiting round checks for Stop. Defaults to SOURCE_URLS_CANCEL_POLL_MS. */
  cancelPollMs?: number;
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
  location?: string,
  signal?: AbortSignal
): Promise<{ call: Awaited<ReturnType<typeof callGoogleAiMode>>; usedImage: boolean }> {
  const once = async (query: string, image?: string) => {
    if (signal?.aborted) throw new SearchApiCallError("Web search cancelled", false);
    try {
      const call = await callGoogleAiMode(query, {
        ...(image ? { imageUrl: image } : {}),
        ...(location ? { location } : {}),
        timeoutMs: SOURCE_URLS_CALL_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
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
      if (!isTransientSearchApiError(error) || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      return once(query, image);
    }
  };
  if (imageUrl) {
    try {
      return { call: await run(buildQuery(true), imageUrl), usedImage: true };
    } catch (error) {
      if (!(error instanceof SearchApiCallError) || signal?.aborted) throw error;
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
  planned: PlannedTry,
  signal?: AbortSignal
): Promise<AttemptOutcome> {
  const imageUrl = input.imageUrl && /^https?:\/\//i.test(input.imageUrl) ? input.imageUrl : undefined;
  const buildQuery = (hasImage: boolean) =>
    planned.text !== undefined
      ? buildPlannedQuery({
          text: planned.text,
          hasImage,
          identity: planned.identity,
          closestMatch: input.plan?.closestMatch === true,
        })
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
    input.location,
    signal
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
  const notListing = links.filter((link) => !looksLikeListingPage(link.url));
  const listingPages = links.length - notListing.length;
  // When the owner limited the search to named websites (the plan's onlyWebsites),
  // a page from anywhere else is dropped, whatever Google answered.
  const pages = notListing.filter((link) => linkIsOnWebsites(link.url, input.plan?.onlyWebsites));
  const otherWebsites = notListing.length - pages.length;
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
  const why = [
    describeRejected(rejected),
    listingPages > 0 ? `${listingPages} a shop listing or search page` : "",
    otherWebsites > 0 ? `${otherWebsites} not on ${input.plan?.onlyWebsites?.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  console.warn("[Source URLs] Google returned pages but none were kept", {
    attempt,
    returned: candidates.length,
    rejected,
    listingPages,
    otherWebsites,
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

/**
 * The links of several answers as one list. A page that more answers named
 * comes first (agreement between independent answers is the best sign that it
 * really is the product), then the page that ranked higher in its own answer
 * (cited pages lead each answer, see rankSources), then the order found. Cut
 * at the safety cap.
 */
export function mergeOutcomes(outcomes: Array<{ sources: SourceUrl[] }>, limit: number = SOURCE_URLS_MAX): SourceUrl[] {
  const pages = new Map<string, { source: SourceUrl; answers: number; best: number; found: number }>();
  let found = 0;
  for (const outcome of outcomes) {
    const countedHere = new Set<string>();
    outcome.sources.forEach((source, rank) => {
      const key = pageKey(source.uri);
      if (countedHere.has(key)) return;
      countedHere.add(key);
      const page = pages.get(key);
      if (page) {
        page.answers += 1;
        page.best = Math.min(page.best, rank);
      } else {
        pages.set(key, { source, answers: 1, best: rank, found: found++ });
      }
    });
  }
  return [...pages.values()]
    .sort((a, b) => b.answers - a.answers || a.best - b.best || a.found - b.found)
    .slice(0, limit)
    .map((page) => page.source);
}

interface RoundResult {
  planned: PlannedTry;
  outcome?: AttemptOutcome;
  /** The failure of a search that did not answer. */
  error?: unknown;
  /** Hung up on after another search of the round already had a usable page; not a failure. */
  skipped?: boolean;
}

export async function searchSourceUrls(input: SearchSourceUrlsInput): Promise<SearchSourceUrlsResult> {
  const costs: AiCallCost[] = [];
  const maxTries = Math.max(1, Math.min(input.maxTries ?? SOURCE_URLS_MAX_TRIES, SOURCE_URLS_MAX_TRIES));
  const startedAt = Date.now();
  // Round 1: the strongest request, several times at once. Round 2, only if
  // that found nothing: the other requests together (see planRounds).
  const rounds = planRounds(input.plan, input.rowData, maxTries);
  const summaries: string[] = [];
  let answered = 0;
  let searchesStarted = 0;
  let usedImage = false;
  let timeLimit = false;
  /** The failure of the first search that did not answer; thrown if no search answers at all. */
  let firstFailure: unknown;

  const missNote = () =>
    `The web search found no page for this item (${describeTries(summaries)}${timeLimit ? "; stopped searching at the time limit" : ""}).`;

  // Every search of a round is sent at once. Each billed call is already in
  // `costs` the moment it returns, so a search that fails after billing, or a
  // round where only some searches answer, loses no charge.
  //
  // The round does not wait for its slowest search: once one search has a
  // usable page the others get a short grace period, then are hung up on (a
  // call that never answered is never billed). While it waits, the round also
  // watches for Stop and hangs up on everything in flight when it is pressed.
  const runRound = async (tries: PlannedTry[]): Promise<RoundResult[]> => {
    const firstNumber = searchesStarted + 1;
    searchesStarted += tries.length;
    const controller = new AbortController();
    const graceMs = input.graceMs ?? SOURCE_URLS_GRACE_MS;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let stoppedByOwner = false;
    const poller = input.shouldCancel
      ? setInterval(() => {
          if (stoppedByOwner || controller.signal.aborted) return;
          void input.shouldCancel!().then(
            (stop) => {
              if (stop && !controller.signal.aborted) {
                stoppedByOwner = true;
                controller.abort();
              }
            },
            () => undefined
          );
        }, input.cancelPollMs ?? SOURCE_URLS_CANCEL_POLL_MS)
      : undefined;
    const results: RoundResult[] = tries.map((planned) => ({ planned }));
    try {
      await Promise.all(
        tries.map(async (planned, index) => {
          try {
            const outcome = await runSearch(input, firstNumber + index, costs, planned, controller.signal);
            results[index] = { planned, outcome };
            if (outcome.sources.length > 0 && graceTimer === undefined && !controller.signal.aborted) {
              graceTimer = setTimeout(() => controller.abort(), graceMs);
            }
          } catch (error) {
            results[index] =
              controller.signal.aborted && !stoppedByOwner ? { planned, skipped: true } : { planned, error };
          }
        })
      );
    } finally {
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (poller !== undefined) clearInterval(poller);
    }
    if (stoppedByOwner) {
      throw new EnrichCancelledError(`Cancelled during Google AI Mode search ${firstNumber}.`, costs);
    }
    return results;
  };

  for (const [roundIndex, tries] of [rounds.first, rounds.second].entries()) {
    if (tries.length === 0) continue;
    if (roundIndex > 0) {
      if (input.shouldCancel && (await input.shouldCancel().catch(() => false))) {
        throw new EnrichCancelledError(`Cancelled before Google AI Mode search ${searchesStarted + 1}.`, costs);
      }
      if (Date.now() - startedAt > SOURCE_URLS_TRIES_BUDGET_MS) {
        timeLimit = true;
        break;
      }
    }

    const results = await runRound(tries);
    const outcomes: AttemptOutcome[] = [];
    for (const result of results) {
      const label = result.planned.label;
      if (result.skipped) continue;
      if (result.outcome) {
        outcomes.push(result.outcome);
        answered += 1;
        usedImage = result.outcome.usedImage;
        summaries.push(label ? `"${label}" ${result.outcome.summary}` : result.outcome.summary);
      } else {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        summaries.push(`${label ? `"${label}" ` : ""}failed: ${hideProviderNames(message.slice(0, 200))}`);
      }
    }

    const merged = mergeOutcomes(outcomes);
    if (merged.length > 0) {
      return {
        sources: merged,
        costs,
        attempts: answered,
        usedImage: outcomes.some((outcome) => outcome.sources.length > 0 && outcome.usedImage),
        notFoundReason: "",
      };
    }

    // Not one search of this round answered. Google AI Mode often fails one
    // particular wording every time (a 503 "could not retrieve results"), so
    // repeating it is pointless: the next round asks the other requests, which
    // are worded differently. The row only fails when no search at all answered.
    if (firstFailure === undefined) firstFailure = results.find((result) => result.error !== undefined)?.error;
  }

  // Not one search of either round answered: nothing was learned, so the row
  // fails as a whole. Any billed call keeps its charge.
  if (answered === 0 && firstFailure !== undefined) {
    const message = firstFailure instanceof Error ? firstFailure.message : String(firstFailure);
    if (costs.length > 0) throw new EnrichBilledAttemptError(message, costs);
    throw firstFailure;
  }

  return {
    sources: [],
    costs,
    attempts: answered,
    usedImage,
    notFoundReason: missNote(),
  };
}