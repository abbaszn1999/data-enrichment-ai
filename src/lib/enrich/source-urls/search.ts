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
 * Billing is per request sent: each request is added to `costs` the moment it
 * goes out, and stays there whether it answered, was hung up on (call
 * timeout, Stop) or its answer was unreadable. Only a request that came
 * back as an error, or never left, is taken out again (see askGoogle).
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
 * failure is often tied to one wording). Whatever the reason a row finds no
 * page (empty answers, timeouts, errors from the provider, no search answering
 * at all) it ends as "Not found" with the costs so far and the reason in the
 * note. The one exception is the app's own setup (no key, a key the provider
 * refuses): that fails the row, because it is not a miss on this item.
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
 * 90 s calls (a photo call and its retry, then the same without the photo),
 * so 360 s + 4 x 90 s + the retry pauses stays inside the 900 s limit: a row
 * is never killed with billed searches that nobody charged.
 */
export const SOURCE_URLS_TRIES_BUDGET_MS = 360_000;

/**
 * The one hard cut: a call that has not answered after this long is hung up on.
 * Live calls answer in 7-20 s and the odd one takes a minute, so there is no
 * shorter limit. A round waits for all its searches, so this is also the most
 * a round can take. The hung-up request is still charged (it was sent) and a
 * late answer is dropped, see askGoogle.
 */
export const SOURCE_URLS_CALL_TIMEOUT_MS = 90_000;

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

/** What a row sent, for the per-row log: requests sent, answered, hung up on, and failed (not charged). */
interface SearchStats {
  sent: number;
  answered: number;
  hungUp: number;
  failed: number;
}

/**
 * One Google AI Mode call. With a photo it tries the photo first; if that call
 * fails (the photo may be unreachable for Google) it retries once without it,
 * because the text search still stands. The prompt mentions the photo only when
 * it is really sent.
 *
 * Billing is per request SENT: the charge is added to `costs` the moment the
 * request goes out, so an unreadable answer, a request hung up on (the call
 * timeout, Stop) and a row that is cancelled all keep their charge. The only requests not charged are those
 * that came back as an error (rate limit, 5xx, network failure; SearchApi does
 * not bill those either) and calls that never left because the row was already
 * stopped.
 */
async function askGoogle(
  buildQuery: (hasImage: boolean) => string,
  imageUrl: string | undefined,
  costs: AiCallCost[],
  retryDelayMs: number,
  location: string | undefined,
  signal: AbortSignal | undefined,
  stats: SearchStats
): Promise<{ call: Awaited<ReturnType<typeof callGoogleAiMode>>; usedImage: boolean }> {
  const once = async (query: string, image?: string) => {
    if (signal?.aborted) throw new SearchApiCallError("Web search cancelled", false);
    const charge = createSearchApiCost(1);
    costs.push(charge);
    stats.sent += 1;
    try {
      const call = await callGoogleAiMode(query, {
        ...(image ? { imageUrl: image } : {}),
        ...(location ? { location } : {}),
        timeoutMs: SOURCE_URLS_CALL_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      stats.answered += 1;
      return call;
    } catch (error) {
      const chargeable = error instanceof SearchApiCallError && (error.billed || error.hungUp);
      if (chargeable) {
        if (error instanceof SearchApiCallError && error.hungUp) stats.hungUp += 1;
      } else {
        // An error answer or a call that never left: not billed by SearchApi, not charged.
        const at = costs.indexOf(charge);
        if (at !== -1) costs.splice(at, 1);
        stats.failed += 1;
      }
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
  signal: AbortSignal | undefined,
  stats: SearchStats
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
    signal,
    stats
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

/**
 * A failure that says the search cannot run at all, whatever the item: no
 * SearchApi key, or a key the provider refuses (401, 402, 403). Those are not
 * "Not found" (that would hide a setup problem behind a normal result), so the
 * row fails. Everything else a search can come back with (an error answer, a
 * timeout, a hang-up, no pages) is a miss on this item.
 */
function isSetupFailure(error: unknown): boolean {
  if (error instanceof SearchApiCallError) {
    return error.status === 401 || error.status === 402 || error.status === 403;
  }
  return true;
}

interface RoundResult {
  planned: PlannedTry;
  outcome?: AttemptOutcome;
  /** The failure of a search that did not answer. */
  error?: unknown;
}

export async function searchSourceUrls(input: SearchSourceUrlsInput): Promise<SearchSourceUrlsResult> {
  const stats: SearchStats = { sent: 0, answered: 0, hungUp: 0, failed: 0 };
  try {
    return await runSourceUrlsSearch(input, stats);
  } finally {
    // One line per row, whatever way it ends: what was sent and what it cost.
    console.info(
      `[Source URLs] requests sent ${stats.sent}, answered ${stats.answered}, hung up on ${stats.hungUp}, failed (not charged) ${stats.failed}`
    );
  }
}

async function runSourceUrlsSearch(input: SearchSourceUrlsInput, stats: SearchStats): Promise<SearchSourceUrlsResult> {
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
  /** A search failure that is the app's own setup, not a miss (see isSetupFailure); thrown if no search answers at all. */
  let setupFailure: unknown;

  const missNote = () =>
    `${
      answered === 0
        ? "The web search got no answer for this item"
        : "The web search found no page for this item"
    } (${describeTries(summaries)}${timeLimit ? "; stopped searching at the time limit" : ""}).`;

  // Every search of a round is sent at once. Each request is already in
  // `costs` the moment it is sent, so a search that is hung up on, or a round
  // where only some searches answer, loses no charge.
  //
  // The round waits for every search of it: all answer, or the call timeout
  // (SOURCE_URLS_CALL_TIMEOUT_MS) hangs up on the ones that do not (they were
  // sent, so they are still charged, and a late answer is dropped). The row is
  // written once, from what answered. While it waits, the round also watches
  // for Stop and hangs up on everything in flight when it is pressed.
  const runRound = async (tries: PlannedTry[]): Promise<RoundResult[]> => {
    const firstNumber = searchesStarted + 1;
    searchesStarted += tries.length;
    const controller = new AbortController();
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
            const outcome = await runSearch(input, firstNumber + index, costs, planned, controller.signal, stats);
            results[index] = { planned, outcome };
          } catch (error) {
            results[index] = { planned, error };
          }
        })
      );
    } finally {
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
    if (setupFailure === undefined) {
      setupFailure = results.find((result) => result.error !== undefined && isSetupFailure(result.error))?.error;
    }
  }

  // Not one search answered and the cause is the app's own setup (no key, a key
  // the provider refuses): that is not a miss on this item, so it fails loudly
  // instead of being reported as "Not found". Any billed call keeps its charge.
  if (answered === 0 && setupFailure !== undefined) {
    const message = setupFailure instanceof Error ? setupFailure.message : String(setupFailure);
    if (costs.length > 0) throw new EnrichBilledAttemptError(message, costs);
    throw setupFailure;
  }

  // Every other way of not finding a page (no pages, empty answers, timeouts,
  // errors from the provider) ends the same way: "Not found", with the reason.
  return {
    sources: [],
    costs,
    attempts: answered,
    usedImage,
    notFoundReason: missNote(),
  };
}