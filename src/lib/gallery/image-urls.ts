import { splitStoredImageRefs, storedImagePath, toStoredImageRef } from "@/lib/stored-image-ref";

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

/** A cell that holds only pictures saved from the uploaded sheet. */
export function isStoredPictureCell(text: string): boolean {
  const refs = splitStoredImageRefs(text);
  if (refs.length === 0) return false;
  let remainder = text;
  for (const ref of refs) remainder = remainder.split(ref).join("");
  return remainder.replace(/[\s,|;]+/g, "").length === 0;
}

/** Photos in an image cell: links plus pictures uploaded from the user's computer. */
export function parseRowPictures(value: unknown): { urls: string[]; storedPaths: string[] } {
  const text = String(value ?? "").trim();
  const seen = new Set<string>();
  const storedPaths: string[] = [];
  for (const ref of splitStoredImageRefs(text)) {
    const path = storedImagePath(ref);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    storedPaths.push(path);
  }
  return { urls: parseImageUrls(text), storedPaths };
}

export function stripStoredImageRefs(value: string): string {
  let text = value;
  for (const ref of splitStoredImageRefs(value)) text = text.split(ref).join(" ");
  return text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Cell value after adding an uploaded photo: existing text stays, the photo goes on a new line. */
export function appendStoredPhoto(value: unknown, path: string): string {
  const text = String(value ?? "").trim();
  const ref = toStoredImageRef(path);
  return text ? `${text}\n${ref}` : ref;
}

export function removeStoredPhoto(value: unknown, path: string): string {
  const ref = toStoredImageRef(path);
  return String(value ?? "")
    .split(ref)
    .join(" ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Only photos saved for this gallery project may be read from storage. */
export function isGalleryPhotoPath(path: string, workspaceId: string, sessionId: string): boolean {
  return (
    path.startsWith(`${workspaceId}/gallery/${sessionId}/rows/`) &&
    !path.includes("..") &&
    !path.includes("//")
  );
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
  if (isStoredPictureCell(text)) return true;
  const hasPhoto = splitStoredImageRefs(text).length > 0;
  if (!cellContainsHttpUrl(text)) return false;
  const urls = parseImageUrls(text);
  if (urls.length === 0) return false;
  let remainder = hasPhoto ? stripStoredImageRefs(text) : text;
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
