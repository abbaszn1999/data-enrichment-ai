/**
 * Source URLs skill: the Google AI Mode query that finds the web pages for ONE
 * exact product, and the parser for its free-text answer. This is the whole
 * "agent" behind the Source URLs output column (see ./agent.ts): a plain
 * search query (SearchApi's `q`), not an OpenAI call, so it has no schema
 * support — the prompt asks for JSON and json-extract.ts pulls it out of
 * whatever text comes back. Independent from the Image Finder's Exact Match
 * skill (image-finder/exact/links-skill.ts): the two share only the generic
 * JSON extractor, so changing one prompt can never change the other.
 *
 * The query is a fixed template with three variable parts: the product (every
 * source column of the row), the store owner's custom instruction (if any),
 * and whether a photo of the item is attached to the call.
 *
 * Two attempts exist: attempt 1 is the normal prompt; attempt 2 runs only when
 * attempt 1 produced no usable page, and asks for DIFFERENT search angles.
 */
import { extractJsonValues } from "../image-finder/exact/json-extract";

/** Hard ceiling on pages per row, whatever the column's own count says. */
export const SOURCE_URLS_MAX = 10;

const MAX_FIELD_CHARS = 300;
const MAX_FIELDS = 20;
const MAX_INSTRUCTION_CHARS = 1_500;
const MAX_TASK_IDENTIFIERS = 3;
const MAX_PROMPT_DOMAINS = 30;
/** SearchApi's documented `q` limit is 8,193 characters; stay under it. */
const MAX_QUERY_CHARS = 8_000;

export type SourceUrlsAttempt = 1 | 2;

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

function displayKey(key: string): string {
  return key.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col");
}

/** Image attachments reach the row data as "[N images attached]" placeholders or raw image links; neither is text about the item. */
function isImageValue(value: string): boolean {
  if (value.startsWith("data:image/")) return true;
  if (/^\[\d+ images? attached\]$/i.test(value)) return true;
  return /^https?:\/\/\S+\.(jpe?g|png|webp|gif|avif)(\?\S*)?$/i.test(value);
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

export interface BuildSourceUrlsQueryInput {
  rowData: Record<string, string>;
  /** Code-like values already extracted from the row (see image-finder/tools/identifiers.ts). */
  rowIdentifiers: string[];
  customInstruction?: string;
  /** How many pages to ask for (the column's source count). */
  maxSources: number;
  /** A photo of the item is attached to the call. */
  hasImage?: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** 1 = normal search; 2 = second try with different angles. Defaults to 1. */
  attempt?: SourceUrlsAttempt;
}

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

function taskLines(identifiers: string[], attempt: SourceUrlsAttempt): string[] {
  const named = identifiers.slice(0, MAX_TASK_IDENTIFIERS).join(", ");
  const item = named
    ? `this exact item, identified by: ${named} (full row below)`
    : "the exact item described below";
  // Wording is deliberate (see exact/links-skill.ts): a long or dramatic task
  // line made Google AI Mode hang, or search the sentence itself. Keep it
  // short and plain.
  if (attempt === 2) {
    return ["TASK", `Find web pages for ${item}. Use search angles beyond the obvious ones.`, "Return links only."];
  }
  return ["TASK", `Find web pages for ${item}.`, "Return links only."];
}

function searchStepLines(attempt: SourceUrlsAttempt): string[] {
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
    "Look across the manufacturer's own site, shops and marketplaces.",
  ];
}

function composeQuery(
  fieldLines: string[],
  identifiers: string[],
  instruction: string,
  maxSources: number,
  hasImage: boolean,
  attempt: SourceUrlsAttempt,
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
  if (hasImage) {
    lines.push(
      "- A photo of the item is attached. Use it to confirm which product this is (shape, colour, packaging, markings). It never overrides a code on the row."
    );
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
    "It chooses which pages to prefer (the manufacturer first, certain shops, a language or region) and overrides the defaults in these steps where they conflict, but it can never justify accepting a different product than the one Step 2 identified.",
    "",
    ...searchStepLines(attempt),
    "",
    "STEP 5 — CONFIRM EACH PAGE",
    "- One product: a detail page dedicated to ONE product (the manufacturer's page, a retailer, marketplace listing or distributor). Never a search page, category or collection page, multi-product list, blog, review, forum, PDF, datasheet-aggregator page or social post.",
    "- Identity, per Step 2: with a code, the code appears in the page text, title, URL or product data (ignore only case, spaces, hyphens and slashes); with no code, the brand, full name and every distinguishing attribute match with no equally good rival.",
    "- Variant: attributes that make a different product must match — model, colour/colourway, capacity or size of the product itself, pack count, edition, generation, flavour, voltage/region. A different suffix, prefix or digit in the code is a different item.",
    "- Live: the page loads now and shows the product — not suspended, parked or out of the catalogue.",
    "- Differences in title wording, language, price, currency, stock status or seller are fine: report them, do not reject for them.",
    "- Every url is the complete https:// address of the page — never a bare domain, never guessed or constructed.",
    "",
    `STEP 6 — RETURN LINKS ONLY, BEST FIRST, UP TO ${maxSources}`,
    `Return up to ${maxSources} full https:// page URLs for this exact item, best first, each with the page's own title. No commentary, no follow-up questions. Never pad the list with near matches: fewer links, or none, is correct when fewer exact pages exist.`,
    "",
    "OUTPUT FORMAT (valid JSON only, no markdown fences, no commentary before or after)",
    '{"result":"FOUND" or "NOT_FOUND","sources":[{"url":"https://...","title":"the page title","matchedOn":"code|barcode|brand+description","evidence":"text from the page that shows the code (or, with no code, the title and brand)","differences":"or none"}]}',
    `Maximum ${maxSources} sources. If none: sources is an empty array.`
  );

  return lines.join("\n");
}

/**
 * Builds the query. The static steps always fit; if the row's fields would
 * push the query past SearchApi's limit, trailing fields are dropped (never
 * the steps or the output format, which sit after them and must survive intact
 * for the answer to be parseable).
 */
export function buildSourceUrlsQuery(input: BuildSourceUrlsQueryInput): string {
  const identifiers = input.rowIdentifiers;
  const attempt = input.attempt ?? 1;
  const maxSources = Math.min(SOURCE_URLS_MAX, Math.max(1, Math.floor(input.maxSources || 1)));
  const instruction = (input.customInstruction ?? "").trim().slice(0, MAX_INSTRUCTION_CHARS);
  const ruleLines = websiteRuleLines(input.allowedDomains ?? [], input.blockedDomains ?? []);
  const hasImage = Boolean(input.hasImage);
  let fields = productDataLines(input.rowData);

  let query = composeQuery(fields, identifiers, instruction, maxSources, hasImage, attempt, ruleLines);
  while (query.length > MAX_QUERY_CHARS && fields.length > 1) {
    fields = fields.slice(0, -1);
    query = composeQuery(fields, identifiers, instruction, maxSources, hasImage, attempt, ruleLines);
  }
  return query;
}

export interface SourceCandidate {
  url: string;
  title?: string;
  matchedOn?: string;
  evidence?: string;
  differences?: string;
}

export interface SourceUrlsParse {
  result: "FOUND" | "NOT_FOUND";
  sources: SourceCandidate[];
  /** False when no JSON of the expected shape could be found (empty or prose-only answer). */
  readable: boolean;
}

const SOURCE_ARRAY_KEYS = ["sources", "matches", "results", "links", "urls", "pages"];
const URL_KEYS = ["url", "link", "href", "uri"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function sourceArrayOf(record: Record<string, unknown>): unknown[] | null {
  for (const key of SOURCE_ARRAY_KEYS) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

function looksLikeSourceList(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" || (isRecord(item) && URL_KEYS.some((key) => key in item)))
  );
}

/** Whether a parsed JSON value is (or contains) the answer we asked for. */
function isAnswerShape(value: unknown): boolean {
  if (isRecord(value)) return "result" in value || sourceArrayOf(value) !== null;
  return looksLikeSourceList(value);
}

function toCandidate(item: unknown): SourceCandidate | null {
  if (typeof item === "string") {
    const url = item.trim();
    return /^https?:\/\//i.test(url) ? { url } : null;
  }
  if (!isRecord(item)) return null;
  const url = String(stringField(item, ...URL_KEYS) ?? "").trim();
  if (!url) return null;
  return {
    url,
    title: stringField(item, "title", "name", "site"),
    matchedOn: stringField(item, "matchedOn", "matched_on"),
    evidence: stringField(item, "evidence"),
    differences: stringField(item, "differences"),
  };
}

/**
 * Parses one rendering of an answer. Looks at every JSON value in the text and
 * takes the one shaped like the answer (an object with `sources`/`result`, or a
 * bare list of links), preferring one that actually lists links.
 */
export function parseSourceUrlsAnswer(text: string): SourceUrlsParse {
  const shaped = extractJsonValues(text, isAnswerShape).filter(isAnswerShape);
  if (shaped.length === 0) return { result: "NOT_FOUND", sources: [], readable: false };

  let best: SourceCandidate[] | null = null;
  for (const value of shaped) {
    const items = isRecord(value) ? (sourceArrayOf(value) ?? []) : (value as unknown[]);
    const candidates = items.map(toCandidate).filter((c): c is SourceCandidate => c !== null);
    if (best === null || (best.length === 0 && candidates.length > 0)) best = candidates;
    if (best.length > 0) break;
  }
  const sources = best ?? [];
  return { result: sources.length > 0 ? "FOUND" : "NOT_FOUND", sources, readable: true };
}

const MARKDOWN_LINK = /\[([^\]]{1,300})\]\((https?:\/\/[^)\s]+)\)/g;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`\]\[(){}|\\^]+/gi;

/** A page title as Google shows it, without the UI text its scraper leaves behind. */
export function cleanPageTitle(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/\\+\|/g, "|")
    .replace(/Go to product viewer dialog for this item\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Last resort for an answer with no readable JSON. For a product with no code,
 * Google AI Mode often ignores the JSON request and answers with its own list
 * of web results (a markdown table of `[title](url)` links). Those are real
 * search results for the product, in Google's order of relevance, so they are
 * used — still through the code-side checks — instead of reporting "none found"
 * just because the answer was in another shape. Never used to second-guess an
 * answer that was readable and listed no pages.
 */
export function harvestSourceCandidates(texts: string[], referenceLinks: string[] = []): SourceCandidate[] {
  const seen = new Set<string>();
  const out: SourceCandidate[] = [];
  const add = (rawUrl: string, title?: string) => {
    const url = rawUrl.replace(/[.,;:!?)\]]+$/, "").trim();
    if (!/^https:\/\//i.test(url)) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, title: cleanPageTitle(title) || undefined, matchedOn: "unstated" });
  };
  for (const text of texts) {
    for (const match of text.matchAll(MARKDOWN_LINK)) add(match[2]!, match[1]);
  }
  for (const text of texts) {
    for (const found of text.match(URL_IN_TEXT) ?? []) add(found);
  }
  for (const link of referenceLinks) add(link);
  return out;
}

/**
 * The answer can sit in the joined text_blocks or in the markdown. Prefer the
 * rendering that lists links, then any that is readable (an explicit "none"),
 * and only then call the answer unreadable.
 */
export function parseBestSourceAnswer(texts: string[]): SourceUrlsParse {
  let readable: SourceUrlsParse | null = null;
  for (const text of texts) {
    const parsed = parseSourceUrlsAnswer(text);
    if (parsed.sources.length > 0) return parsed;
    if (parsed.readable && !readable) readable = parsed;
  }
  return readable ?? { result: "NOT_FOUND", sources: [], readable: false };
}
