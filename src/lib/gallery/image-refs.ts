/** Normalize image path/URL refs for reliable delete matching. */
export function normalizeImageRef(value: string): string {
  return value.trim().replaceAll("&amp;", "&");
}

function stripQuery(value: string): string {
  return value.split("?")[0] || value;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * True when two worksheet image refs point at the same asset.
 * Handles encoding differences and signed-URL vs storage-path forms.
 */
export function imageRefsMatch(a: string, b: string): boolean {
  const left = normalizeImageRef(a);
  const right = normalizeImageRef(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const decodedLeft = safeDecode(left);
  const decodedRight = safeDecode(right);
  if (decodedLeft === decodedRight) return true;

  const bareLeft = stripQuery(decodedLeft);
  const bareRight = stripQuery(decodedRight);
  if (bareLeft === bareRight) return true;

  // Prefer suffix match on storage keys / object names (min length avoids
  // accidental matches on short fragments).
  const shorter = bareLeft.length <= bareRight.length ? bareLeft : bareRight;
  const longer = bareLeft.length <= bareRight.length ? bareRight : bareLeft;
  if (shorter.length >= 12 && longer.endsWith(shorter)) return true;

  return false;
}
