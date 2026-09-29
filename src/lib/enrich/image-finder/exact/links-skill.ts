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
 * The prompt follows six steps, in this order: read the row as a whole,
 * decide the identity path (code vs no code), apply the store owner's
 * instruction, search broadly and verify narrowly, confirm each candidate
 * against the exact-match rules, return links only.
 */
import { extractJsonObject } from "./json-extract";

/** Agent 1 returns at most this many exact-match links, best first. */
export const EXACT_LINKS_MAX = 10;

const MAX_FIELD_CHARS = 300;
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
}

function composeQuery(fieldLines: string[], identifiers: string[], instruction: string): string {
  const lines: string[] = [
    "ROLE",
    "You are a senior product-data analyst. Your job: find web links to product pages that are EXACTLY the one catalog item below — nothing else. Precision matters more than recall: returning no link is the correct answer when no exact page exists.",
    "",
    "CATALOG ITEM (every field the row has; missing fields are unknown)",
    ...(fieldLines.length > 0 ? fieldLines : ["- No usable product data was provided."]),
  ];
  if (identifiers.length > 0) {
    lines.push(`- Code-like values in this row (the strongest proof of identity): ${identifiers.join(", ")}`);
  }

  lines.push(
    "",
    "STEP 1 — READ THE ROW AS A WHOLE",
    "Use every field above. Never rely on a column's name; judge each value by what it contains. A field that lists related, similar or \"bought with\" products describes OTHER products — never use it to identify this one.",
    "",
    "STEP 2 — DECIDE THE IDENTITY PATH",
    "- The row has a code (SKU, barcode, manufacturer part number or model number): the code is the ONLY proof of identity. Title, price, package wording and every other field are context, never proof.",
    "- The row has no code: identify the item by brand + full description + every distinguishing attribute (colour, size, capacity, pack count, material, edition). Pick ONE candidate that clearly fits. If two different products fit about equally well, that is no match — never guess between them.",
    "",
    "STEP 3 — STORE OWNER INSTRUCTION",
    instruction || "None given.",
    "It narrows or redirects the search (preferred or excluded sites, brands, regions) and overrides the defaults in these steps where they conflict, but it can never justify accepting a different product than the one Step 2 identified.",
    "",
    "STEP 4 — SEARCH BROADLY, VERIFY NARROWLY",
    "Search several angles before concluding: the code alone in quotes; code + brand; the barcode if present; brand + full name + key attributes; regional and local-language variants. Consider all shops and marketplaces, not only Amazon. A search snippet is never proof: open every candidate and confirm it on the page itself before including it.",
    "",
    "STEP 5 — CONFIRM EACH CANDIDATE",
    "A page qualifies only if ALL of these hold:",
    "1. One product: a product detail page dedicated to ONE product (retailer, marketplace listing, distributor, or brand/manufacturer page).",
    "2. Identity, per Step 2: with a code, the page text, URL or structured data shows the code character-for-character (ignore only case, spacing, hyphens and slashes); with no code, the brand, full name and every distinguishing attribute match with no equally good rival.",
    "3. Variant: attributes that make a different product must match: model, colour/colourway, capacity or size of the product itself, pack count, edition, generation, flavour, voltage/region. A different suffix, prefix or digit in the code is a different item. Clothing or shoe sizes offered on the page are fine.",
    "4. Brand: must not contradict the catalog brand. The page need not show the brand when the code already proves identity.",
    "5. Live: the page loads now and shows the product — never a suspended, parked, expired or out-of-catalogue page.",
    "Differences in title wording, language, price, currency, stock status, condition or seller are NOT reasons to reject a page; report them instead.",
    "Never return: search-result pages, category or collection pages, multi-product lists, price-comparison search pages, blogs, reviews, forums, PDFs, datasheet-aggregator pages, social posts, or any URL you have not opened. Never guess or construct a URL. Every url must be a complete address starting with https:// that points to the single product page, never a bare domain.",
    "",
    `STEP 6 — RETURN LINKS ONLY, BEST FIRST, UP TO ${EXACT_LINKS_MAX}`,
    `Return up to ${EXACT_LINKS_MAX} full https:// product-page URLs, best first. No images, no commentary, no follow-up questions. Never pad the list with near matches: fewer links, or none, is correct when fewer exact matches exist.`,
    "",
    "OUTPUT FORMAT (valid JSON only, no markdown fences, no commentary before or after)",
    '{"result":"MATCHES_FOUND" or "NO_EXACT_MATCH","matches":[{"url":"https://...","site":"","matchedOn":"code|barcode|brand+description","evidence":"verbatim page text containing the code (or, with no code, the title and brand)","differences":"or none"}]}',
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
  const instruction = (input.customInstruction ?? "").trim().slice(0, MAX_INSTRUCTION_CHARS);
  let fields = productDataLines(input.rowData);

  let query = composeQuery(fields, identifiers, instruction);
  while (query.length > MAX_QUERY_CHARS && fields.length > 1) {
    fields = fields.slice(0, -1);
    query = composeQuery(fields, identifiers, instruction);
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

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** Tolerant of the casing the model actually used (camelCase asked for; snake_case sometimes returned). */
export function parseExactLinksResult(text: string): ExactLinksResult {
  const parsed = extractJsonObject(text);
  if (!parsed) return { result: "NO_EXACT_MATCH", matches: [] };

  const rawMatches = Array.isArray(parsed.matches) ? parsed.matches : [];
  const matches: ExactLinkCandidate[] = [];
  for (const item of rawMatches) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = String(record.url ?? "").trim();
    if (!url) continue;
    matches.push({
      url,
      site: stringField(record, "site"),
      matchedOn: stringField(record, "matchedOn", "matched_on"),
      evidence: stringField(record, "evidence"),
      differences: stringField(record, "differences"),
    });
  }

  return {
    result: parsed.result === "MATCHES_FOUND" ? "MATCHES_FOUND" : "NO_EXACT_MATCH",
    matches,
  };
}
