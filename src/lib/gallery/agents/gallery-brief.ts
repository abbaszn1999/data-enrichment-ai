/**
 * Per-row brief for the Gallery research agent. Pure (no I/O) so it is cheap
 * to test. Every selected column is read by its content, never its name:
 * image-file links become input images, other links become known source
 * pages, everything else is product data.
 */
import type { GalleryScrapingSettings } from "@/lib/gallery/types";
import { parseImageUrls } from "@/lib/gallery/image-urls";

/** New gallery images are requested with a few reserves that the guards may drop. */
export const GALLERY_RESERVE_CANDIDATES = 3;
export const GALLERY_MAX_IMAGES = 12;
const MAX_INPUT_IMAGES = 6;
const MAX_SOURCE_PAGES = 12;
const MAX_KNOWN_IMAGES_LISTED = 30;
const FIELD_VALUE_CHARS = 400;

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i;

/** A link that is clearly an image file (extension in the path). Ambiguous CDN paths count as pages. */
export function isImageFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return IMAGE_EXTENSION.test(parsed.pathname);
  } catch {
    return false;
  }
}

export interface ClassifiedRow {
  /** Plain text fields (URL cells removed), in column order. */
  fields: Array<{ column: string; value: string }>;
  /** Image-file links found in selected columns, in column order. */
  imageUrls: string[];
  /** Other http(s) links (product pages), in column order. */
  sourceUrls: string[];
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

function isPrimarilyUrls(text: string, urls: string[]): boolean {
  let rest = text;
  for (const url of urls) rest = rest.split(url).join("");
  return rest.replace(/[\s,|;]+/g, "").length === 0;
}

export function classifyRowValues(
  rowData: Record<string, string>,
  selectedColumns: string[],
  options?: { fieldChars?: number }
): ClassifiedRow {
  const fieldChars = options?.fieldChars ?? FIELD_VALUE_CHARS;
  const columns = selectedColumns.length ? selectedColumns : Object.keys(rowData);
  const fields: ClassifiedRow["fields"] = [];
  const imageUrls: string[] = [];
  const sourceUrls: string[] = [];
  const seen = new Set<string>();
  for (const column of columns) {
    const raw = String(rowData[column] ?? "").trim();
    if (!raw) continue;
    if (raw.startsWith("data:image/")) continue;
    const urls = parseImageUrls(raw);
    if (urls.length > 0 && isPrimarilyUrls(raw, urls)) {
      for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        (isImageFileUrl(url) ? imageUrls : sourceUrls).push(url);
      }
      continue;
    }
    const plain = toPlainText(raw);
    if (plain) fields.push({ column, value: plain.slice(0, fieldChars) });
  }
  return { fields, imageUrls, sourceUrls };
}

/** Text-only row (URL cells and images removed): what identifiers and word matching read. */
export function textOnlyRow(classified: ClassifiedRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of classified.fields) out[field.column] = field.value;
  return out;
}

export function sourcePolicyLine(policy: GalleryScrapingSettings["sourcePolicy"]): string {
  switch (policy) {
    case "official-only":
      return "Use only official brand or manufacturer pages and images. Skip retailers and marketplaces.";
    case "prefer-official":
      return "Prefer official brand or manufacturer pages, then reputable retailers. Marketplaces last.";
    default:
      return "Official brand pages, reputable retailers and marketplaces are all acceptable, as long as the item is the exact same product.";
  }
}

export const RESEARCH_DEPTH_LABELS: Record<GalleryScrapingSettings["searchDepth"], string> = {
  low: "quick — check the sheet's source pages and a few best matches",
  medium: "balanced — sheet sources plus several independent stores and the brand site",
  high: "deep — sheet sources, brand site, many retailers, and secondary pages until the count is met",
};

export interface GalleryBriefInput {
  classified: ClassifiedRow;
  /** Main image links (the required image column), first among the input images. */
  mainImageUrls: string[];
  /** Number of NEW gallery images the store owner wants. */
  count: number;
  settings: Pick<
    GalleryScrapingSettings,
    "instructions" | "sourcePolicy" | "minResolution" | "aspectRatio" | "searchDepth"
  >;
  rowIdentifiers?: string[];
}

export interface GalleryBrief {
  text: string;
  /** Links to attach as input images: Main first, then the row's other images. */
  inputImageUrls: string[];
  /** Image links the sheet already has, which must never be returned. */
  knownImageUrls: string[];
  sourcePageUrls: string[];
  /** How many candidates the agent may return (count + reserves). */
  maxCandidates: number;
}

export function buildGalleryBrief(input: GalleryBriefInput): GalleryBrief {
  const count = Math.min(GALLERY_MAX_IMAGES, Math.max(1, Math.round(input.count)));
  const maxCandidates = Math.min(GALLERY_MAX_IMAGES + GALLERY_RESERVE_CANDIDATES, count + GALLERY_RESERVE_CANDIDATES);

  const knownImageUrls: string[] = [];
  const pushKnown = (url: string) => {
    const trimmed = url.trim();
    if (trimmed && !knownImageUrls.includes(trimmed)) knownImageUrls.push(trimmed);
  };
  for (const url of input.mainImageUrls) if (/^https?:\/\//i.test(url)) pushKnown(url);
  for (const url of input.classified.imageUrls) pushKnown(url);
  const inputImageUrls = knownImageUrls.slice(0, MAX_INPUT_IMAGES);
  const sourcePageUrls = input.classified.sourceUrls.slice(0, MAX_SOURCE_PAGES);

  const sections: string[] = [];
  sections.push(
    "## Product data",
    input.classified.fields.length > 0
      ? input.classified.fields.map((field) => `- ${displayKey(field.column)}: ${field.value}`).join("\n")
      : "- No usable product data was provided; rely on the attached images and source pages."
  );

  sections.push(
    "",
    "## Input images",
    inputImageUrls.length === 0
      ? "None attached."
      : `${inputImageUrls.length} image${inputImageUrls.length === 1 ? " is" : "s are"} attached (the first ${
          Math.min(inputImageUrls.length, Math.max(1, input.mainImageUrls.length))
        } ${input.mainImageUrls.length <= 1 ? "is the Main image" : "are the Main images"}). They show the exact item: confirm every gallery image is the same product, colour, variant and pack.`
  );
  if (inputImageUrls.length > 0) {
    sections.push(inputImageUrls.map((url, index) => `${index + 1}. ${url}`).join("\n"));
  }

  sections.push(
    "",
    "## Known source pages (open these first)",
    sourcePageUrls.length === 0
      ? "None in the sheet. Find the exact item's pages yourself."
      : sourcePageUrls.map((url) => `- ${url}`).join("\n")
  );

  sections.push(
    "",
    "## Images the sheet already has (never return these or resized copies of them)",
    knownImageUrls.length === 0
      ? "None."
      : knownImageUrls
          .slice(0, MAX_KNOWN_IMAGES_LISTED)
          .map((url) => `- ${url}`)
          .join("\n")
  );

  sections.push(
    "",
    "## Number of new gallery images",
    `The store owner wants ${count} NEW gallery image${count === 1 ? "" : "s"} for this exact item, each from a different perspective. Return them best first. If more good candidates exist than requested, you may add up to ${maxCandidates - count} reserve image${maxCandidates - count === 1 ? "" : "s"} at the end of the list. Return fewer only when the web truly does not show more verified images of this exact item.`
  );

  const custom = input.settings.instructions.trim();
  if (custom) {
    sections.push("", "## Custom instruction (store owner, highest priority)", custom);
  }

  const preferences = [
    `- Sources: ${sourcePolicyLine(input.settings.sourcePolicy)}`,
    input.settings.minResolution > 0
      ? `- Preferred minimum resolution: ${input.settings.minResolution}px on the shortest side. Larger is better; still use a smaller image of a perspective nothing else covers.`
      : "- Preferred minimum resolution: none.",
    input.settings.aspectRatio !== "any"
      ? `- Preferred aspect ratio: ${input.settings.aspectRatio}.`
      : "- Preferred aspect ratio: any.",
    `- Research depth: ${RESEARCH_DEPTH_LABELS[input.settings.searchDepth]}.`,
  ];
  sections.push("", "## Preferences", ...preferences);

  const identifiers = input.rowIdentifiers ?? [];
  sections.push(
    "",
    "## Row identifiers",
    identifiers.length > 0
      ? `Code-like values in this row (check_pages and fetch_page report which of them appear on each page): ${identifiers.join(", ")}`
      : "None: this row has no SKU, barcode or model code. Identify the item by brand, title, variant attributes and the attached images."
  );

  return { text: sections.join("\n"), inputImageUrls, knownImageUrls, sourcePageUrls, maxCandidates };
}
