/**
 * Supabase Storage keys accept only ASCII letters, digits and a few symbols,
 * so a file named "تقرير.md" cannot be stored as is. Path segments outside
 * that set are stored base64url-encoded behind a marker and decoded for
 * display, so names in any language round-trip exactly.
 */

const PLAIN_SEGMENT = /^[\w.\- ()]+$/;
const MARKER = "u8.";

export function encodeStorageSegment(segment: string): string {
  if (PLAIN_SEGMENT.test(segment) && !segment.startsWith(MARKER)) return segment;
  return MARKER + Buffer.from(segment, "utf8").toString("base64url");
}

export function decodeStorageSegment(segment: string): string {
  if (!segment.startsWith(MARKER)) return segment;
  const decoded = Buffer.from(segment.slice(MARKER.length), "base64url").toString("utf8");
  return decoded || segment;
}

/** A relative path ("reports/تقرير.md") as a valid Storage key, segment by segment. */
export function encodeStoragePath(relative: string): string {
  return relative.split("/").map(encodeStorageSegment).join("/");
}

export function decodeStoragePath(key: string): string {
  return key.split("/").map(decodeStorageSegment).join("/");
}
