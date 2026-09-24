/**
 * Structured per-row brief for the Image Finder agent. Order is fixed:
 * product identity, other product data, reference image, number of images,
 * custom instruction, website rules. Pure (no runtime imports) so it is cheap
 * to test.
 */

export const IMAGE_FINDER_MIN_IMAGES = 1;
export const IMAGE_FINDER_MAX_IMAGES = 10;
export const IMAGE_FINDER_DEFAULT_IMAGES = 3;
const MAX_REFERENCE_IMAGES = 4;
const IDENTITY_VALUE_CHARS = 200;
const CONTEXT_VALUE_CHARS = 500;

export interface ImageFinderBriefInput {
  rowData: Record<string, string>;
  imageCount?: number;
  customInstruction?: string;
  /** Already-sanitized website rules (see lib/enrich/domains). */
  allowedDomains?: string[];
  blockedDomains?: string[];
}

export interface ImageFinderBrief {
  text: string;
  referenceImageUrls: string[];
  imageCount: number;
}

/** Identity fields in display order; within a field, earlier keys win. */
const IDENTITY_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Brand", keys: ["brand", "brandname", "manufacturer", "vendor", "make"] },
  {
    label: "Model / MPN",
    keys: ["model", "modelnumber", "modelno", "mpn", "manufacturerpartnumber", "partnumber"],
  },
  {
    label: "SKU",
    keys: ["sku", "variantsku", "itemcode", "productcode", "itemnumber", "articlenumber"],
  },
  {
    label: "Barcode (GTIN / EAN / UPC)",
    keys: ["gtin", "gtin13", "gtin14", "ean", "ean13", "upc", "barcode", "variantbarcode", "isbn", "jan"],
  },
  {
    label: "Title",
    keys: ["title", "producttitle", "name", "productname", "enhancedtitle"],
  },
  {
    label: "Category",
    keys: ["category", "categories", "producttype", "type", "productcategory", "department"],
  },
];

const VARIANT_WORD = /(colou?r|size|material|finish|flavou?r|capacity)/;
const OPTION_VALUE = /^option\d*value$/;

export function clampImageCount(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : IMAGE_FINDER_DEFAULT_IMAGES;
  return Math.min(IMAGE_FINDER_MAX_IMAGES, Math.max(IMAGE_FINDER_MIN_IMAGES, n));
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
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

function isVariantKey(normalized: string): boolean {
  return normalized === "variant" || OPTION_VALUE.test(normalized) || VARIANT_WORD.test(normalized);
}

export function buildImageFinderBrief(input: ImageFinderBriefInput): ImageFinderBrief {
  const imageCount = clampImageCount(input.imageCount);
  const referenceImageUrls: string[] = [];
  const text: Array<{ key: string; normalized: string; value: string }> = [];

  for (const [key, raw] of Object.entries(input.rowData)) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    if (isImageValue(value)) {
      if (referenceImageUrls.length < MAX_REFERENCE_IMAGES) referenceImageUrls.push(value);
      continue;
    }
    const plain = toPlainText(value);
    if (plain) text.push({ key, normalized: normalizeKey(key), value: plain });
  }

  const used = new Set<string>();
  const identityLines: string[] = [];
  for (const field of IDENTITY_FIELDS) {
    for (const candidate of field.keys) {
      const match = text.find((entry) => !used.has(entry.key) && entry.normalized === candidate);
      if (!match) continue;
      used.add(match.key);
      identityLines.push(
        `- ${field.label} (column "${displayKey(match.key)}"): ${match.value.slice(0, IDENTITY_VALUE_CHARS)}`
      );
      break;
    }
  }

  const variantParts: string[] = [];
  for (const entry of text) {
    if (used.has(entry.key) || !isVariantKey(entry.normalized)) continue;
    used.add(entry.key);
    variantParts.push(
      `column "${displayKey(entry.key)}": ${entry.value.slice(0, IDENTITY_VALUE_CHARS)}`
    );
  }
  if (variantParts.length > 0) identityLines.push(`- Variant: ${variantParts.join("; ")}`);

  const contextLines = text
    .filter((entry) => !used.has(entry.key))
    .map((entry) => `- ${displayKey(entry.key)}: ${entry.value.slice(0, CONTEXT_VALUE_CHARS)}`);

  const referenceLine =
    referenceImageUrls.length === 0
      ? "None attached."
      : `${referenceImageUrls.length} reference image${
          referenceImageUrls.length === 1 ? " is" : "s are"
        } attached. Use ${referenceImageUrls.length === 1 ? "it" : "them"} to confirm you found the same product and variant.`;

  const customInstruction = input.customInstruction?.trim() ?? "";

  const sections = [
    "## Product identity",
    identityLines.length > 0
      ? identityLines.join("\n")
      : "- No identity fields were detected. Rely on the product data below.",
    "",
    "## Other product data",
    contextLines.length > 0 ? contextLines.join("\n") : "- None",
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

  return { text: sections.join("\n"), referenceImageUrls, imageCount };
}
