/**
 * Structured per-row brief for the Image Finder agent. Every column is listed
 * as one flat "Product data" section, in the sheet's own column order — there
 * is no pre-sorted "identity" vs "other" split. Deciding which fields actually
 * identify the product (brand, model, SKU) and which attributes define its
 * variant is the agent's own job, using the skill's method, not a fixed
 * field-name lookup here. Order after the product data is fixed: reference
 * image, number of images, custom instruction, website rules, row
 * identifiers, sheet-learned websites, re-check hint. Pure (no runtime
 * imports) so it is cheap to test.
 */

/**
 * Image Finder has no user-chosen count: it gathers every distinct photo of
 * the exact item its verified sources show, up to this many.
 */
export const IMAGE_FINDER_MAX_IMAGES = 7;
const MAX_REFERENCE_IMAGES = 4;
const FIELD_VALUE_CHARS = 400;

export interface ImageFinderBriefInput {
  rowData: Record<string, string>;
  customInstruction?: string;
  /** Already-sanitized website rules (see lib/enrich/domains). */
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** Code-like values from the row, as written (see tools/identifiers). */
  rowIdentifiers?: string[];
  /** Websites where other rows of this sheet were verified, most first. */
  learnedDomains?: string[];
  /** Final re-check of a row that ended Not found in the first pass. */
  recheck?: boolean;
}

export interface ImageFinderBrief {
  text: string;
  referenceImageUrls: string[];
  imageCount: number;
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
  const imageCount = IMAGE_FINDER_MAX_IMAGES;
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
    `Return every distinct image of this exact item that its verified sources show, up to ${imageCount}.`,
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

  const identifiers = input.rowIdentifiers ?? [];
  if (identifiers.length > 0) {
    sections.push(
      "",
      "## Row identifiers",
      `Code-like values in this row (check_pages and fetch_page report which of them appear on each page): ${identifiers.join(", ")}`
    );
  } else if (input.rowIdentifiers) {
    sections.push(
      "",
      "## Row identifiers",
      "None: this row has no SKU, barcode or model code. Use the best-match rules: one item whose brand and description clearly match this row, with its brand in brandSeen and matchBasis best_match."
    );
  }

  const learned = allowed.length > 0 ? [] : (input.learnedDomains ?? []);
  if (learned.length > 0) {
    sections.push(
      "",
      "## Websites where other products of this sheet were verified",
      learned.join(", "),
      "Strong leads: run each one's own site search for this row's identifiers early."
    );
  }
  if (input.recheck) {
    sections.push(
      "",
      "## Final re-check",
      "An earlier search for this row ended without a verified match. Before anything else, run the own site search of each website listed above for every row identifier, and open every plausible result (and its structured data) before concluding."
    );
  }

  return { text: sections.join("\n"), referenceImageUrls, imageCount };
}
