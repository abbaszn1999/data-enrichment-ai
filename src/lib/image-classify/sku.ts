/**
 * SKU helpers for image classification.
 */

export function filenameStem(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").trim();
}

export function humanizeFilename(filename: string): string {
  const stem = filenameStem(filename);
  if (!stem) return filename;
  return stem
    .replace(/[_]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reject title-like filenames used as "SKU" (e.g. Technical-SEO-Mastery-for-eCom-Brands).
 * Real SKUs are typically short and code-like, or follow a customer-defined pattern.
 */
export function sanitizeSku(
  sku: string | null | undefined,
  filename: string
): string {
  const raw = (sku ?? "").trim();
  if (!raw) return "";

  const stem = filenameStem(filename);
  if (stem && raw.toLowerCase() === stem.toLowerCase()) return "";
  if (raw.length > 40) return "";

  const parts = raw.split(/[-_\s./]+/).filter(Boolean);
  const hasDigit = /\d/.test(raw);
  const longAlphaParts = parts.filter(
    (part) => /^[A-Za-z]+$/.test(part) && part.length >= 3
  ).length;

  // Descriptive title slug: many word segments, little/no code structure.
  if (!hasDigit && parts.length >= 3 && longAlphaParts >= 3) return "";
  if (!hasDigit && raw.length > 24 && parts.length >= 2) return "";

  return raw;
}

export function imageCaption(sku: string | null | undefined, filename: string): {
  primary: string;
  isSku: boolean;
} {
  const clean = sanitizeSku(sku, filename);
  if (clean) return { primary: clean, isSku: true };
  return { primary: humanizeFilename(filename) || filename, isSku: false };
}
