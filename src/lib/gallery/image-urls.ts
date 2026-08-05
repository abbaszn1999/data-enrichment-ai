export function parseImageUrls(value: unknown): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of text.split(/[\s,|;]+/)) {
    const candidate = part.trim();
    if (!/^https?:\/\//i.test(candidate) || seen.has(candidate)) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      seen.add(candidate);
      urls.push(candidate);
    } catch {
      // Ignore malformed cells while preserving the rest of the row.
    }
  }
  return urls;
}

/** Cheap gate before full URL parsing. */
export function cellContainsHttpUrl(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (text.length < 8 || !/https?:\/\//i.test(text)) return false;
  return parseImageUrls(text).length > 0;
}

/**
 * True when the cell is URL-valued (one or more http(s) URLs) rather than prose
 * that merely mentions a link.
 */
export function cellIsPrimarilyHttpUrl(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (!cellContainsHttpUrl(text)) return false;
  const urls = parseImageUrls(text);
  if (urls.length === 0) return false;
  let remainder = text;
  for (const url of urls) {
    remainder = remainder.split(url).join("");
  }
  return remainder.replace(/[\s,|;]+/g, "").length === 0;
}

/**
 * Columns whose sampled non-empty cells are primarily http(s) URLs.
 * Fast: capped sample, early accept/reject, no column-name heuristics.
 */
export function listColumnsWithHttpUrls(params: {
  columns: string[];
  rows: Array<{ originalData?: Record<string, string> }>;
  /** Max rows to inspect per worksheet (keeps UI snappy on large sheets). */
  sampleSize?: number;
  /**
   * Minimum share of non-empty sampled cells that must be URL-valued.
   * Default 0.25 filters out free-text fields that rarely embed a link.
   */
  minUrlShare?: number;
}): string[] {
  const sampleSize = Math.max(1, params.sampleSize ?? 40);
  const minUrlShare = Math.min(1, Math.max(0, params.minUrlShare ?? 0.25));
  const sample = params.rows.slice(0, sampleSize);
  if (sample.length === 0 || params.columns.length === 0) return [];

  return params.columns.filter((column) => {
    let nonEmpty = 0;
    let urlHits = 0;
    for (let index = 0; index < sample.length; index += 1) {
      const text = String(sample[index]?.originalData?.[column] ?? "").trim();
      if (!text) continue;
      nonEmpty += 1;
      if (cellIsPrimarilyHttpUrl(text)) urlHits += 1;

      const rowsLeft = sample.length - index - 1;
      if (urlHits / (nonEmpty + rowsLeft) >= minUrlShare && urlHits > 0) {
        return true;
      }
      if ((urlHits + rowsLeft) / Math.max(nonEmpty + rowsLeft, 1) < minUrlShare) {
        return false;
      }
    }
    if (nonEmpty === 0) return false;
    return urlHits / nonEmpty >= minUrlShare;
  });
}
