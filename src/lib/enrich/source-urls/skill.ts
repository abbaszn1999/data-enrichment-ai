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
 * The query is deliberately tiny — a task line, the product (every source
 * column of the row), the store owner's custom instruction when there is one,
 * and a line about the photo when one is attached. Google AI Mode answers
 * best to a short, plain request (a long rulebook made it behave like a strict
 * code search that returns few pages, and a dramatic one made it hang), and a
 * photo does the heavy lifting when the row has one. The code-side link checks
 * (search.ts) do the policing, not the prompt.
 *
 * There is one query. A row that finds nothing is searched again with exactly
 * the same query (search.ts): the answers vary from one search to the next, and
 * rewording the retry did not do better than repeating it.
 */
import { extractJsonValues } from "../image-finder/exact/json-extract";

/**
 * Safety cap on pages kept per row. It is not a setting and the prompt never
 * mentions it: it only keeps one cell, the saved sheet and the next prompt
 * (when this column is used as a source) from growing without bound.
 */
export const SOURCE_URLS_MAX = 15;

const MAX_FIELD_CHARS = 600;
const MAX_FIELDS = 20;
const MAX_INSTRUCTION_CHARS = 1_500;
/** SearchApi's documented `q` limit is 8,193 characters; stay under it. */
const MAX_QUERY_CHARS = 8_000;

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
  customInstruction?: string;
  /** A photo of the item is attached to the call. */
  hasImage?: boolean;
}

function composeQuery(fieldLines: string[], instruction: string, hasImage: boolean): string {
  // Wording is deliberate: keep the task line short and plain. Describing a
  // failed search ("found nothing usable") made Google AI Mode search that
  // sentence itself, so nothing about earlier tries is ever said.
  const hasText = fieldLines.length > 0;
  const sellers =
    "from any seller in any country or language: the brand's own site, manufacturers and factories (for example Alibaba, 1688), wholesalers, retailers and marketplaces.";

  // Photo only: the first line tells Google to identify the item before searching.
  const task =
    !hasText && hasImage
      ? `Identify the product in the attached photo, then find every web page that sells that exact product, ${sellers}`
      : `Find every web page that sells this exact product, ${sellers}`;

  const lines: string[] = [task];
  if (hasText || !hasImage) {
    lines.push("", "PRODUCT", ...(hasText ? fieldLines : ["- No usable product data was provided."]));
  }
  // Photo plus text: one plain line. Asking Google to "confirm" pages against the photo made it
  // over-strict when the photo was slightly off.
  if (hasText && hasImage) lines.push("", "The attached photo shows the same product.");
  // Strict by default. With an owner's instruction the owner decides which
  // variants count as the same product (a size, a very similar code), so the
  // sentence defers to it instead of contradicting it.
  lines.push(
    "",
    instruction
      ? "Same product only. If the owner's instruction below says which variants count as the same product, follow it. Otherwise a different colour, size or model does not count. Aim for 10 or more pages."
      : "Same product only. A different colour, size or model does not count. Aim for 10 or more pages."
  );
  // Last before the output format, and ranked above the default rules, so the
  // owner's way of searching is not drowned out by them.
  if (instruction) {
    lines.push(
      "",
      `Instruction from the store owner (it takes priority over the rules above, except the JSON format below): ${instruction}`
    );
  }
  lines.push(
    "",
    "Return full product page links (no search or category pages), best first, as JSON only:",
    '{"sources":[{"url":"https://...","title":"page title"}]}'
  );
  return lines.join("\n");
}

/**
 * Builds the query. The task and output format always fit; if the row's fields
 * would push the query past SearchApi's limit, trailing fields are dropped
 * (never the output format, which sits after them and must survive intact for
 * the answer to be parseable).
 */
export function buildSourceUrlsQuery(input: BuildSourceUrlsQueryInput): string {
  const instruction = (input.customInstruction ?? "").trim().slice(0, MAX_INSTRUCTION_CHARS);
  const hasImage = Boolean(input.hasImage);
  let fields = productDataLines(input.rowData);

  let query = composeQuery(fields, instruction, hasImage);
  while (query.length > MAX_QUERY_CHARS && fields.length > 1) {
    fields = fields.slice(0, -1);
    query = composeQuery(fields, instruction, hasImage);
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
 * Used when the answer names no page: either there is no readable JSON (for a
 * product with no code, Google AI Mode often ignores the JSON request and
 * answers with its own list of web results, a markdown table of `[title](url)`
 * links) or the JSON names only a home page or nothing while Google cites
 * product pages. The links in the answer text and Google's cited
 * `reference_links` are real search results, in Google's order of relevance, so
 * they are used — still through the code-side checks — instead of reporting
 * "none found" just because the answer was in another shape.
 */
export function harvestSourceCandidates(texts: string[], referenceLinks: string[] = []): SourceCandidate[] {
  const seen = new Set<string>();
  const out: SourceCandidate[] = [];
  const add = (rawUrl: string, title?: string) => {
    // Google's cited links carry a "#:~:text=..." highlight; the page is the same without it.
    const url = rawUrl.replace(/#:~:text=.*$/i, "").replace(/[.,;:!?)\]]+$/, "").trim();
    // Plain http:// pages count too: many small manufacturer and factory sites still use it.
    if (!/^https?:\/\//i.test(url)) return;
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
