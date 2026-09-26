/**
 * Code-like values from a row (SKUs, barcodes, model/version tokens such as
 * `ESP32-S3` or `631958`) and a boundary-exact way to tell whether a page
 * contains them. Column names are never consulted, so this works for any sheet.
 */

export interface RowIdentifier {
  /** As written in the sheet. */
  value: string;
  /** Uppercase, separators removed — the comparison key. */
  key: string;
  /** Strong identifiers are specific enough to prove identity on their own. */
  strong: boolean;
}

const MAX_IDENTIFIERS = 12;
const SEPARATORS = /[-_./]/;

export function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[\s\-_./]+/g, "");
}

/**
 * Quantities, pack counts and measurements (4PCS, 1000ML, 2.4G, 433MHz, 16GB,
 * PDQ30, 12V) describe a variant; they appear on countless unrelated pages
 * and can never prove identity.
 */
const QUANTITY_OR_MEASURE =
  /^(\d+(?:[.,]\d+)?(?:pcs?|pieces?|pack|pk|sets?|pairs?|pr|ml|l|ltr|mm|cm|m|km|in|inch|ft|g|gr|kg|lb|lbs|oz|v|w|kw|a|mah|ah|kb|mb|gb|tb|hz|khz|mhz|ghz|k|mp|x|ch)|pdq\d+|x\d+)$/i;

function isCodeLike(token: string): boolean {
  if (token.length < 4 || token.length > 40) return false;
  if (!/\d/.test(token)) return false;
  // Prices and decimals (299.99, 1,299.00) are not identifiers.
  if (/^\d+([.,]\d+)+$/.test(token)) return false;
  if (QUANTITY_OR_MEASURE.test(token)) return false;
  if (/^\d+$/.test(token)) return token.length >= 5;
  return /[A-Za-z]/.test(token);
}

function isStrong(token: string): boolean {
  const key = normalizeCode(token);
  if (/^\d+$/.test(key)) return key.length >= 6;
  return key.length >= 6 && /[A-Z]/.test(key) && /\d/.test(key);
}

const TOKEN_SPLIT = /[\s,;:()[\]{}|"'<>]+/;
const IDENTITY_LABEL = /^\s*(sku|mpn|model|part|p\/n|pn|code|barcode|ean|upc|gtin|isbn|ref|reference|item)\b[^:]*:/i;

/**
 * Splits a cell into list segments when it is a list of items (keywords,
 * "similar", "bought with", specs): three or more `|` / `;` / newline
 * segments, or five or more comma segments. Returns null for ordinary text.
 */
function listSegments(text: string): string[] | null {
  const strong = text.split(/\s*[|;\n]\s*/).filter(Boolean);
  if (strong.length >= 3) return strong;
  const commas = text.split(/\s*,\s+/).filter(Boolean);
  return commas.length >= 5 ? commas : null;
}

function cleanToken(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

/**
 * Code-like values that identify THIS row. Codes that only appear inside
 * list-like cells (related, similar or "bought with" products, keyword lists)
 * belong to other products and are left out, unless the list segment is
 * labelled as an identifier ("MPN: …", "Barcode: …").
 */
export function extractRowIdentifiers(rowData: Record<string, string>): RowIdentifier[] {
  const identity: string[] = [];
  for (const raw of Object.values(rowData)) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const segments = listSegments(text);
    if (!segments) {
      if (!/\s/.test(text)) identity.push(text);
      identity.push(...text.split(TOKEN_SPLIT));
      continue;
    }
    for (const segment of segments) {
      if (IDENTITY_LABEL.test(segment)) identity.push(...segment.replace(IDENTITY_LABEL, "").split(TOKEN_SPLIT));
    }
  }

  const out: RowIdentifier[] = [];
  const seen = new Set<string>();
  for (const raw of identity) {
    const value = cleanToken(raw);
    if (!isCodeLike(value)) continue;
    const key = normalizeCode(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value, key, strong: isStrong(value) });
  }
  return out
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.key.length - a.key.length)
    .slice(0, MAX_IDENTIFIERS);
}

/**
 * Every separator-bounded run inside every code-like token of `text`,
 * normalized. "SKU: ESP32-S3-N16R8" yields ESP32, ESP32S3, ESP32S3N16R8,
 * S3, S3N16R8, N16R8 — so a row code matches only on real token boundaries,
 * never as an arbitrary substring (631958 does not match 16319580).
 */
export function codeKeysInText(text: string): Set<string> {
  const keys = new Set<string>();
  const tokens = text.match(/[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*/g) ?? [];
  for (const token of tokens) {
    if (!/\d/.test(token)) continue;
    const parts = token.split(SEPARATORS).slice(0, 8);
    for (let start = 0; start < parts.length; start += 1) {
      let joined = "";
      for (let end = start; end < parts.length; end += 1) {
        joined += parts[end]!.toUpperCase();
        if (joined.length >= 4) keys.add(joined);
      }
    }
  }
  return keys;
}

export function identifiersSeenIn(text: string, identifiers: RowIdentifier[]): RowIdentifier[] {
  if (identifiers.length === 0) return [];
  const keys = codeKeysInText(text);
  return identifiers.filter((identifier) => keys.has(identifier.key));
}

export interface NearCodeMatch {
  /** The row's own code, normalized. */
  rowKey: string;
  rowValue: string;
  /** The page's code that differs only by trailing letters, normalized. */
  pageCode: string;
}

const NEAR_SUFFIX = /^[A-Z]{1,2}$/;

/**
 * Page codes that differ from a strong row code only by 1–2 trailing letters,
 * in either direction (sheet AN5120 / page AN5120N, or the reverse) — the
 * pattern of package or ordering suffixes and of sheets that dropped a
 * letter. The shorter code must end in a digit, so this is always an appended
 * suffix, never a cut inside a code. All-digit codes (barcodes) and digit
 * changes never qualify. Whether the suffix is harmless is judged by the
 * model; code only records the pattern.
 */
export function nearIdentifiersSeenIn(text: string, identifiers: RowIdentifier[]): NearCodeMatch[] {
  const candidates = identifiers.filter((id) => id.strong && /[A-Z]/.test(id.key) && /\d/.test(id.key));
  if (candidates.length === 0) return [];
  const keys = codeKeysInText(text);
  const out: NearCodeMatch[] = [];
  const seen = new Set<string>();
  for (const id of candidates) {
    for (const key of keys) {
      if (key === id.key) continue;
      const [shorter, longer] = key.length < id.key.length ? [key, id.key] : [id.key, key];
      if (shorter.length < 5 || !/\d$/.test(shorter) || !longer.startsWith(shorter)) continue;
      if (!NEAR_SUFFIX.test(longer.slice(shorter.length))) continue;
      const dedupe = `${id.key}>${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ rowKey: id.key, rowValue: id.value, pageCode: key });
    }
  }
  return out;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "new", "set", "sets", "pcs", "pack", "piece", "pieces",
  "size", "color", "colour", "colors", "colours", "item", "items", "product", "products", "original", "genuine",
  "assorted", "ass", "mix", "mixed", "style", "styles", "model", "type", "each", "per", "box", "price", "one",
  "two", "three", "four", "five", "six", "yes", "stock", "available", "unit", "units", "brand", "none",
  "pdq", "asst", "pcs", "pc", "pk",
]);

/** Lowercased letters/digits separated by single spaces — the form pages and rows are compared in. */
export function normalizeMatchText(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

/**
 * The words that describe a row without codes: letters-only words of 3+
 * characters from its ordinary (non-list) cells, minus stop words, numbers,
 * codes and URLs. Column names are never used.
 */
export function distinctiveWords(rowData: Record<string, string>, limit = 15): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Object.values(rowData)) {
    const text = String(raw ?? "").trim();
    if (!text || /^https?:\/\//i.test(text) || listSegments(text)) continue;
    for (const word of normalizeMatchText(text).trim().split(" ")) {
      if (word.length < 3 || /\d/.test(word) || STOP_WORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      out.push(word);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Share of `words` present in normalized page text. Words of 4+ letters also
 * match a longer or shorter form sharing the stem ("shoe" / "shoes").
 */
export function wordsPresentRatio(words: string[], normalizedText: string): number {
  if (words.length === 0) return 0;
  const pageWords = normalizedText.trim().split(" ");
  const pageSet = new Set(pageWords);
  let present = 0;
  for (const word of words) {
    if (pageSet.has(word)) {
      present += 1;
      continue;
    }
    if (word.length >= 4 && pageWords.some((p) => p.length >= 4 && (p.startsWith(word) || word.startsWith(p)))) {
      present += 1;
    }
  }
  return present / words.length;
}
