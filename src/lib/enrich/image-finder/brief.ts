/**
 * Structured per-row brief for the Image Finder agent. Every column is listed
 * as one flat "Product data" section, in the sheet's own column order — there
 * is no pre-sorted "identity" vs "other" split. Deciding which fields actually
 * identify the product (brand, model, SKU) is the agent's own job, using the
 * skill's method, not a fixed field-name lookup here. This also means a
 * variant/color field is just another line, not a special category — the
 * skill treats variant as optional unless the custom instruction says
 * otherwise. Order after the product data is fixed: reference image, number
 * of images, custom instruction, website rules, store catalog matches. Pure
 * (no runtime imports) so it is cheap to test.
 */

import type { StoreCatalogMatch } from "./store-lookup";

export const IMAGE_FINDER_MIN_IMAGES = 1;
export const IMAGE_FINDER_MAX_IMAGES = 10;
export const IMAGE_FINDER_DEFAULT_IMAGES = 3;
const MAX_REFERENCE_IMAGES = 4;
const FIELD_VALUE_CHARS = 400;

export interface ImageFinderBriefInput {
  rowData: Record<string, string>;
  imageCount?: number;
  customInstruction?: string;
  /** Already-sanitized website rules (see lib/enrich/domains). */
  allowedDomains?: string[];
  blockedDomains?: string[];
  storeMatches?: StoreCatalogMatch[];
}

export interface ImageFinderBrief {
  text: string;
  referenceImageUrls: string[];
  imageCount: number;
}

export function clampImageCount(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : IMAGE_FINDER_DEFAULT_IMAGES;
  return Math.min(IMAGE_FINDER_MAX_IMAGES, Math.max(IMAGE_FINDER_MIN_IMAGES, n));
}

function displayKey(key: string): string {
  return key.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col");
}

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

/** Same detection as the generic enrich prompt: inline data URIs or direct image files. */
function isImageValue(value: string): boolean {
  if (value.startsWith("data:image/")) return true;
  return /^https?:\/\//i.test(value) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(value);
}

export function buildImageFinderBrief(input: ImageFinderBriefInput): ImageFinderBrief {
  const imageCount = clampImageCount(input.imageCount);
  const referenceImageUrls: string[] = [];
  const fieldLines: string[] = [];

  for (const [key, raw] of Object.entries(input.rowData)) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    if (isImageValue(value)) {
      if (referenceImageUrls.length < MAX_REFERENCE_IMAGES) referenceImageUrls.push(value);
      continue;
    }
    const plain = toPlainText(value);
    if (plain) fieldLines.push(`- ${displayKey(key)}: ${plain.slice(0, FIELD_VALUE_CHARS)}`);
  }

  const referenceLine =
    referenceImageUrls.length === 0
      ? "None attached."
      : `${referenceImageUrls.length} reference image${
          referenceImageUrls.length === 1 ? " is" : "s are"
        } attached. Use ${referenceImageUrls.length === 1 ? "it" : "them"} to confirm you found the same product.`;

  const customInstruction = input.customInstruction?.trim() ?? "";

  const sections = [
    "## Product data",
    fieldLines.length > 0 ? fieldLines.join("\n") : "- No usable product data was provided.",
    "",
    "## Reference image",
    referenceLine,
    "",
    "## Number of images",
    `Return up to ${imageCount} image${imageCount === 1 ? "" : "s"} of this exact product.`,
  ];
  if (customInstruction) {
    sections.push("", "## Custom instruction (store owner, highest priority)", customInstruction);
  }

  const allowed = input.allowedDomains ?? [];
  const blocked = input.blockedDomains ?? [];
  if (allowed.length > 0 || blocked.length > 0) {
    sections.push("", "## Website rules (enforced)");
    if (allowed.length > 0) {
      sections.push(`- Only use images from: ${allowed.join(", ")} (subdomains included)`);
    }
    if (blocked.length > 0) {
      sections.push(`- Never use images from: ${blocked.join(", ")}`);
    }
  }

  const matches = input.storeMatches ?? [];
  if (matches.length > 0) {
    sections.push(
      "",
      "## Store catalog matches",
      "Read live from the store just now. Each product's SKU or barcode exactly matches this row."
    );
    for (const match of matches) {
      const codes = [
        match.vendor && `Vendor: ${match.vendor}`,
        match.skus.length > 0 && `SKU: ${match.skus.join(", ")}`,
        match.barcodes.length > 0 && `Barcode: ${match.barcodes.join(", ")}`,
      ].filter(Boolean);
      sections.push(
        `- ${match.title || "Untitled product"} — ${match.pageUrl}`,
        ...(codes.length > 0 ? [`  ${codes.join(" · ")}`] : []),
        "  Images:",
        ...match.imageUrls.map((url) => `  - ${url}`)
      );
    }
  }

  return { text: sections.join("\n"), referenceImageUrls, imageCount };
}
