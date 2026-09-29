/**
 * Exact Match Agent 1 orchestration: one Google AI Mode search, and — only
 * when that produced no usable link — one automatic second try with a
 * different prompt (different search angles, see links-skill.ts). Each
 * SearchApi call that returned HTTP 200 is billed, so every call that ran is
 * reported in `costs`, whatever the outcome.
 *
 * A failed call on attempt 1 (bad key, network, non-200) throws as-is —
 * nothing was billed. A failure on attempt 2 does not throw: attempt 1
 * already answered, so the row stays Not found (with attempt 1's cost and
 * the failure in the note).
 */
import { createSearchApiCost, type AiCallCost } from "@/lib/ai-pricing";
import { EnrichCancelledError } from "../../openai";
import { checkExactLinksDetailed, describeRejected, type CheckedExactLink } from "./links-checks";
import {
  buildExactLinksQuery,
  EXACT_LINKS_MAX,
  parseExactLinksAnswer,
  type ExactLinksAttempt,
} from "./links-skill";
import { callGoogleAiMode } from "./searchapi";

export interface SearchExactLinksInput {
  rowData: Record<string, string>;
  rowIdentifiers: string[];
  customInstruction?: string;
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

async function runAttempt(input: SearchExactLinksInput, attempt: ExactLinksAttempt): Promise<AttemptOutcome> {
  const query = buildExactLinksQuery({
    rowData: input.rowData,
    rowIdentifiers: input.rowIdentifiers,
    customInstruction: input.customInstruction,
    attempt,
  });
  const { text } = await callGoogleAiMode(query);
  const answer = parseExactLinksAnswer(text);
  const { links, rejected } = checkExactLinksDetailed(answer.matches, input.rowIdentifiers, EXACT_LINKS_MAX);

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

  const first = await runAttempt(input, 1);
  costs.push(createSearchApiCost(1));
  if (first.links.length > 0) {
    return { links: first.links, costs, attempts: 1, notFoundReason: "" };
  }

  if (input.shouldCancel && (await input.shouldCancel().catch(() => false))) {
    throw new EnrichCancelledError("Cancelled before the second Google AI Mode search.", costs);
  }

  // The first search answered ("nothing usable"), so a failure of the second
  // one must not turn the row into an error: it stays Not found, with the
  // failure in the note. A failed call is not billed, so no cost is added.
  let second: AttemptOutcome;
  try {
    second = await runAttempt(input, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      links: [],
      costs,
      attempts: 2,
      notFoundReason: `Google AI Mode found no exact-match product page for this item (search 1: ${first.summary}; search 2 failed: ${message.slice(0, 200)}).`,
    };
  }
  costs.push(createSearchApiCost(1));
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
