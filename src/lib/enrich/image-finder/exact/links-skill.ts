/**
 * Exact Match Agent 1 skill: builds the Google AI Mode query that finds
 * exact-match product-page links, and parses its free-text answer. This is
 * a plain-text search query (SearchApi's `q` parameter), not an OpenAI
 * Responses call, so it has no schema support — the prompt asks for JSON
 * and json-extract.ts pulls it out of whatever text comes back. Independent
 * from Standard's and Premium's skills (skill.ts / standard-skill.ts):
 * changing this prompt can never affect them. Pure (no runtime imports
 * beyond json-extract) so it is cheap to test.
 *
 * The prompt opens with the search task (the item and its strongest
 * identifier), then six steps: read the row as a whole, decide the identity
 * path (code vs no code), apply the store owner's instruction, search
 * (queries built from what the row contains — nothing catalog-specific is
 * hard-coded), confirm each candidate, return links only.
 *
 * Two attempts exist: attempt 1 is the normal prompt; attempt 2 runs only
 * when attempt 1 produced no usable link, and asks for DIFFERENT search
 * angles instead of repeating the obvious ones.
 */
import { extractJsonValues } from "./json-extract";

/** Agent 1 returns at most this many exact-match links, best first. */
export const EXACT_LINKS_MAX = 10;

const MAX_FIELD_CHARS = 600;
const MAX_FIELDS = 20;
const MAX_INSTRUCTION_CHARS = 1_500;
const MAX_TASK_IDENTIFIERS = 3;
/** SearchApi's documented `q` limit is 8,193 characters; stay under it. */
const MAX_QUERY_CHARS = 8_000;

export type ExactLinksAttempt = 1 | 2;

function toPlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isImageValue(value: string): boolean {
  if (value.startsWith("data:image/")) return true;
  return /^https?:\/\//i.test(value) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(value);
}

function displayKey(key: string): string {
  return key.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col");
}

/** Every non-image column with a value, in sheet order — column names are never consulted for meaning. */
function productDataLines(rowData: Record<string, string>): string[] {
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(rowData)) {
    if (lines.length >= MAX_FIELDS) break;
    const value = String(raw ?? "").trim();
    if (!value || isImageValue(value)) continue;
    const plain = toPlainText(value);
    if (plain) lines.push(`- ${displayKey(key)}: ${plain.slice(0, MAX_FIELD_CHARS)}`);
  }
  return lines;
}

export interface BuildExactLinksQueryInput {
  rowData: Record<string, string>;
  /** Code-like values already extracted from the row (see tools/identifiers.ts). */
  rowIdentifiers: string[];
  customInstruction?: string;
  /** Store owner's website rules (already sanitized). The link checks enforce them; the prompt steers the search. */
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** 1 = normal search; 2 = second try with different angles. Defaults to 1. */
  attempt?: ExactLinksAttempt;
}

/** Only the first few domains go into the query (the link checks still enforce the full list). */
const MAX_PROMPT_DOMAINS = 30;

function websiteRuleLines(allowed: string[], blocked: string[]): string[] {
  const lines: string[] = [];
  if (allowed.length > 0) {
    lines.push(`Website rules: only return pages on these websites: ${allowed.slice(0, MAX_PROMPT_DOMAINS).join(", ")}.`);
  }
  if (blocked.length > 0) {
    lines.push(`Website rules: never return pages on these websites: ${blocked.slice(0, MAX_PROMPT_DOMAINS).join(", ")}.`);
  }
  return lines;
}

function taskLines(identifiers: string[], attempt: ExactLinksAttempt): string[] {
  const named = identifiers.slice(0, MAX_TASK_IDENTIFIERS).join(", ");
  const item = named
    ? `this exact item, identified by: ${named} (full row below)`
    : "the exact item described below";
  // Wording is deliberate: live tests against Google AI Mode showed that
  // "Search thoroughly before concluding there are none" made it hang past
  // 90s, and that describing a failed first search ("found nothing usable")
  // made it search that sentence as a web query and answer with a list of
  // web results instead of JSON. Keep the task line short and plain.
  if (attempt === 2) {
    return [
      "TASK",
      `Find product pages for ${item}. Use search angles beyond the obvious ones.`,
      "Return links only.",
    ];
  }
  return ["TASK", `Find product pages for ${item}.`, "Return links only."];
}

function searchStepLines(attempt: ExactLinksAttempt): string[] {
  if (attempt === 2) {
    return [
      "STEP 4 — SEARCH (new angles only; build your own queries from what this row contains)",
      "1. The manufacturer's or brand's own website and its product catalogue.",
      "2. Every identifier on the row (code, model, part number, barcode), each in other common formats: with and without separators, obvious prefix or suffix forms.",
      "3. Other marketplaces, distributors and regional or local-language shops.",
      "4. The product described in other words or another language, with its brand and the attributes that tell it apart from its variants.",
    ];
  }
  return [
    "STEP 4 — SEARCH (build your own queries from what this row contains)",
    "Start from the strongest identifier the row has, then widen only if needed:",
    "1. The strongest identifier alone, in quotes.",
    "2. The same identifier written the other common ways (with and without separators, obvious prefix or suffix forms).",
    "3. That identifier + the brand, if the row has one.",
    "4. No identifier: brand + full product name + the attributes that tell it apart from its variants.",
    "5. Alternate wording or local-language names, if the row's market suggests it.",
    "Look across all shops, marketplaces and the manufacturer's own site.",
  ];
}

function composeQuery(
  fieldLines: string[],
  identifiers: string[],
  instruction: string,
  attempt: ExactLinksAttempt,
  ruleLines: string[]
): string {
  const lines: string[] = [
    ...taskLines(identifiers, attempt),
    "",
    "PRODUCT (every field the row has; missing fields are unknown)",
    ...(fieldLines.length > 0 ? fieldLines : ["- No usable product data was provided."]),
  ];
  if (identifiers.length > 0) {
    lines.push(`- Code-like values in this row (the strongest proof of identity): ${identifiers.join(", ")}`);
  }

  lines.push(
    "",
    "STEP 1 — READ THE ROW AS A WHOLE",
    "Use every field. Judge each value by what it contains, not by its column name. Ignore fields that list related, similar or \"bought with\" products — they describe OTHER products.",
    "",
    "STEP 2 — DECIDE THE IDENTITY PATH",
    "- The row has a code (SKU, barcode, part number, model number): the code is the ONLY proof of identity. Title, price and every other field are context, never proof.",
    "- The row has no code: identify by brand + full description + every distinguishing attribute (colour, size, capacity, pack count, material, edition). Pick ONE clear candidate. If two different products fit about equally well, that is no match — never guess between them.",
    "",
    "STEP 3 — STORE OWNER INSTRUCTION",
    instruction || "None given.",
    ...ruleLines,
    "It narrows or redirects the search (preferred or excluded sites, brands, regions) and overrides the defaults in these steps where they conflict, but it can never justify accepting a different product than the one Step 2 identified.",
    "",
    ...searchStepLines(attempt),
    "",
    "STEP 5 — CONFIRM EACH LINK",
    "- One product: a detail page dedicated to ONE product (retailer, marketplace listing, distributor, or brand page). Never a search page, category or collection page, multi-product list, blog, review, forum, PDF, datasheet-aggregator page or social post.",
    "- Identity, per Step 2: with a code, the code appears in the page text, title, URL or product data (ignore only case, spaces, hyphens and slashes); with no code, the brand, full name and every distinguishing attribute match with no equally good rival.",
    "- Variant: attributes that make a different product must match — model, colour/colourway, capacity or size of the product itself, pack count, edition, generation, flavour, voltage/region. A different suffix, prefix or digit in the code is a different item. Clothing or shoe sizes offered on the page are fine.",
    "- Brand: must not contradict the row. The page need not show the brand when the code already proves identity.",
    "- Live: the page loads now and shows the product — not suspended, parked or out of the catalogue.",
    "- Differences in title wording, language, price, currency, stock status, condition or seller are fine: report them, do not reject for them.",
    "- Every url is the complete https:// address of the product page — never a bare domain, never guessed or constructed.",
    "",
    `STEP 6 — RETURN LINKS ONLY, BEST FIRST, UP TO ${EXACT_LINKS_MAX}`,
    `Return up to ${EXACT_LINKS_MAX} full https:// product-page URLs, best first. No images, no commentary, no follow-up questions. Never pad the list with near matches: fewer links, or none, is correct when fewer exact matches exist.`,
    "",
    "OUTPUT FORMAT (valid JSON only, no markdown fences, no commentary before or after)",
    '{"result":"MATCHES_FOUND" or "NO_EXACT_MATCH","matches":[{"url":"https://...","site":"","matchedOn":"code|barcode|brand+description","evidence":"text from the result or page that shows the code (or, with no code, the title and brand)","differences":"or none"}]}',
    `Maximum ${EXACT_LINKS_MAX} matches. If none: matches is an empty array.`
  );

  return lines.join("\n");
}

/**
 * Builds the Agent 1 query. The static steps always fit; if the row's fields
 * would push the query past SearchApi's limit, trailing fields are dropped
 * (never the steps or the output format, which sit after them and must
 * survive intact for the answer to be parseable).
 */
export function buildExactLinksQuery(input: BuildExactLinksQueryInput): string {
  const identifiers = input.rowIdentifiers;
  const attempt = input.attempt ?? 1;
  const instruction = (input.customInstruction ?? "").trim().slice(0, MAX_INSTRUCTION_CHARS);
  const ruleLines = websiteRuleLines(input.allowedDomains ?? [], input.blockedDomains ?? []);
  let fields = productDataLines(input.rowData);

  let query = composeQuery(fields, identifiers, instruction, attempt, ruleLines);
  while (query.length > MAX_QUERY_CHARS && fields.length > 1) {
    fields = fields.slice(0, -1);
    query = composeQuery(fields, identifiers, instruction, attempt, ruleLines);
  }
  return query;
}

export interface ExactLinkCandidate {
  url: string;
  site?: string;
  matchedOn?: string;
  evidence?: string;
  differences?: string;
}

export interface ExactLinksResult {
  result: "MATCHES_FOUND" | "NO_EXACT_MATCH";
  matches: ExactLinkCandidate[];
}

export interface ExactLinksParse extends ExactLinksResult {
  /** False when no JSON object could be found in the text (empty or prose-only answer). */
  readable: boolean;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

const MATCH_ARRAY_KEYS = ["matches", "results", "links", "urls", "pages", "products"];
const URL_KEYS = ["url", "link", "href", "uri"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function matchArrayOf(record: Record<string, unknown>): unknown[] | null {
  for (const key of MATCH_ARRAY_KEYS) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

function looksLikeMatchList(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" || (isRecord(item) && URL_KEYS.some((key) => key in item)))
  );
}

/** Whether a parsed JSON value is (or contains) the answer we asked for. */
function isAnswerShape(value: unknown): boolean {
  if (isRecord(value)) return "result" in value || matchArrayOf(value) !== null;
  return looksLikeMatchList(value);
}

function toCandidate(item: unknown): ExactLinkCandidate | null {
  if (typeof item === "string") {
    const url = item.trim();
    return /^https?:\/\//i.test(url) ? { url } : null;
  }
  if (!isRecord(item)) return null;
  const url = String(stringField(item, ...URL_KEYS) ?? "").trim();
  if (!url) return null;
  return {
    url,
    site: stringField(item, "site"),
    matchedOn: stringField(item, "matchedOn", "matched_on"),
    evidence: stringField(item, "evidence"),
    differences: stringField(item, "differences"),
  };
}

/**
 * Like parseExactLinksResult, but also says whether the answer was readable
 * at all (so "unreadable" can be told apart from "none found"). Looks at
 * every JSON value in the text and takes the one shaped like the answer (an
 * object with `matches`/`result`, or a bare list of links), preferring one
 * that actually lists links. Whenever links are listed the answer counts as
 * MATCHES_FOUND, whatever the `result` field says.
 */
export function parseExactLinksAnswer(text: string): ExactLinksParse {
  const shaped = extractJsonValues(text, isAnswerShape).filter(isAnswerShape);
  if (shaped.length === 0) return { result: "NO_EXACT_MATCH", matches: [], readable: false };

  let best: ExactLinkCandidate[] | null = null;
  for (const value of shaped) {
    const items = isRecord(value) ? (matchArrayOf(value) ?? []) : (value as unknown[]);
    const candidates = items.map(toCandidate).filter((c): c is ExactLinkCandidate => c !== null);
    if (best === null || (best.length === 0 && candidates.length > 0)) best = candidates;
    if (best.length > 0) break;
  }
  const matches = best ?? [];
  return {
    result: matches.length > 0 ? "MATCHES_FOUND" : "NO_EXACT_MATCH",
    matches,
    readable: true,
  };
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`\]\[(){}|\\^]+/gi;

/**
 * Last resort for an answer with no readable JSON: pick the https links out of
 * the answer text and the pages Google AI Mode cited. They are unverified
 * leads (`matchedOn` is left unstated), so they still go through the link
 * checks and Agent 2 opens and confirms each one before any image is kept.
 * Only used when the answer was unreadable — never to second-guess an answer
 * that plainly said there is no exact match.
 */
export function harvestLinkCandidates(text: string, referenceLinks: string[] = []): ExactLinkCandidate[] {
  const seen = new Set<string>();
  const out: ExactLinkCandidate[] = [];
  const add = (raw: string) => {
    const url = raw.replace(/[.,;:!?)\]]+$/, "").trim();
    if (!/^https:\/\//i.test(url)) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, matchedOn: "unstated" });
  };
  for (const found of text.match(URL_IN_TEXT) ?? []) add(found);
  for (const link of referenceLinks) add(link);
  return out;
}

/** Tolerant of the casing the model actually used (camelCase asked for; snake_case sometimes returned). */
export function parseExactLinksResult(text: string): ExactLinksResult {
  const { result, matches } = parseExactLinksAnswer(text);
  return { result, matches };
}
