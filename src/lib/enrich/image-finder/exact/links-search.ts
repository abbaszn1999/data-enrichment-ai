/**
 * Exact Match Agent 1 orchestration: one Google AI Mode search, and — only
 * when that produced no usable link — one automatic second try with a
 * different prompt (different search angles, see links-skill.ts). Each
 * SearchApi call that returned HTTP 200 is billed, so every such call is
 * added to `costs` the moment it returns — before its answer is read — and
 * an answer that turns out unreadable can never lose the charge.
 *
 * A failed call on attempt 1 (bad key, network, non-200) throws as-is —
 * nothing was billed. A failure on attempt 2 does not throw: attempt 1
 * already answered, so the row stays Not found (with attempt 1's cost and
 * the failure in the note).
 */
import { createSearchApiCost, type AiCallCost } from "@/lib/ai-pricing";
import type { DomainRules } from "../../domains";
import { EnrichBilledAttemptError, EnrichCancelledError } from "../../openai";
import { checkExactLinksDetailed, describeRejected, type CheckedExactLink } from "./links-checks";
import {
  buildExactLinksQuery,
  EXACT_LINKS_MAX,
  harvestLinkCandidates,
  parseExactLinksAnswer,
  type ExactLinksAttempt,
  type ExactLinksParse,
} from "./links-skill";
import { callGoogleAiMode, SearchApiCallError } from "./searchapi";

export interface SearchExactLinksInput {
  rowData: Record<string, string>;
  rowIdentifiers: string[];
  customInstruction?: string;
  /** Store owner's website rules (already sanitized): steer Agent 1's search and are enforced on its links. */
  domainRules?: DomainRules;
  shouldCancel?: () => Promise<boolean>;
}

export interface SearchExactLinksResult {
  links: CheckedExactLink[];
  /** One SearchApi cost per Google AI Mode call that ran. */
  costs: AiCallCost[];
  /** Number of Google AI Mode calls made (1 or 2). */
  attempts: number;
  /** Human-readable explanation, set when `links` is empty. */
  notFoundReason: string;
}

interface AttemptOutcome {
  links: CheckedExactLink[];
  summary: string;
}

/**
 * The answer can sit in the joined text_blocks or in the markdown. Prefer the
 * rendering that lists links, then any that is readable (an explicit "no
 * exact match"), and only then call the answer unreadable.
 */
export function parseBestAnswer(texts: string[]): ExactLinksParse {
  let readable: ExactLinksParse | null = null;
  for (const text of texts) {
    const parsed = parseExactLinksAnswer(text);
    if (parsed.matches.length > 0) return parsed;
    if (parsed.readable && !readable) readable = parsed;
  }
  return readable ?? { result: "NO_EXACT_MATCH", matches: [], readable: false };
}

async function runAttempt(
  input: SearchExactLinksInput,
  attempt: ExactLinksAttempt,
  costs: AiCallCost[]
): Promise<AttemptOutcome> {
  const query = buildExactLinksQuery({
    rowData: input.rowData,
    rowIdentifiers: input.rowIdentifiers,
    customInstruction: input.customInstruction,
    allowedDomains: input.domainRules?.allowedDomains,
    blockedDomains: input.domainRules?.blockedDomains,
    attempt,
  });

  let call: Awaited<ReturnType<typeof callGoogleAiMode>>;
  try {
    call = await callGoogleAiMode(query);
  } catch (error) {
    // A billed failure keeps its charge even though there is no answer.
    if (error instanceof SearchApiCallError && error.billed) costs.push(createSearchApiCost(1));
    throw error;
  }
  // Recorded before the answer is read: this call was billed whatever follows.
  costs.push(createSearchApiCost(1));

  let answer = parseBestAnswer(call.texts);
  let harvested = false;
  if (!answer.readable) {
    // No JSON we can read: fall back to the links in the answer text and the
    // pages Google cited. They are leads only; the checks and Agent 2 verify.
    const leads = harvestLinkCandidates(
      call.texts.join("\n"),
      call.referenceLinks.map((ref) => ref.link)
    );
    if (leads.length > 0) {
      answer = { result: "MATCHES_FOUND", matches: leads, readable: true };
      harvested = true;
    }
  }

  const { links, rejected } = checkExactLinksDetailed(
    answer.matches,
    input.rowIdentifiers,
    EXACT_LINKS_MAX,
    input.domainRules
  );

  console.log("[Image Finder/Exact] Google AI Mode call", {
    attempt,
    httpStatus: call.httpStatus,
    ms: call.elapsedMs,
    readable: answer.readable,
    harvestedFromText: harvested,
    linksListed: answer.matches.length,
    linksKept: links.length,
    linksRejected: Object.values(rejected).reduce((sum, count) => sum + (count ?? 0), 0),
    referenceLinks: call.referenceLinks.length,
    identifiers: input.rowIdentifiers.slice(0, 3),
  });

  if (links.length > 0) return { links, summary: "" };
  if (!answer.readable) return { links: [], summary: "the answer could not be read" };
  if (answer.matches.length === 0) return { links: [], summary: "returned no links" };
  const why = describeRejected(rejected);
  return {
    links: [],
    summary: `returned ${answer.matches.length} link(s), all rejected${why ? `: ${why}` : ""}`,
  };
}

export async function searchExactLinks(input: SearchExactLinksInput): Promise<SearchExactLinksResult> {
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
  if (first.links.length > 0) {
    return { links: first.links, costs, attempts: 1, notFoundReason: "" };
  }

  if (input.shouldCancel && (await input.shouldCancel().catch(() => false))) {
    throw new EnrichCancelledError("Cancelled before the second Google AI Mode search.", costs);
  }

  // The first search answered ("nothing usable"), so a failure of the second
  // one must not turn the row into an error: it stays Not found, with the
  // failure in the note. A failed call adds a cost only if SearchApi billed it.
  let second: AttemptOutcome;
  try {
    second = await runAttempt(input, 2, costs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      links: [],
      costs,
      attempts: 2,
      notFoundReason: `Google AI Mode found no exact-match product page for this item (search 1: ${first.summary}; search 2 failed: ${message.slice(0, 200)}).`,
    };
  }
  if (second.links.length > 0) {
    return { links: second.links, costs, attempts: 2, notFoundReason: "" };
  }

  return {
    links: [],
    costs,
    attempts: 2,
    notFoundReason: `Google AI Mode found no exact-match product page for this item (search 1: ${first.summary}; search 2: ${second.summary}).`,
  };
}
