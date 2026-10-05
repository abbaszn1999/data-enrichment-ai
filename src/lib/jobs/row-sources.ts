import type { KnownPage } from "@/lib/enrich/types";
import { splitStoredImageRefs } from "@/lib/stored-image-ref";
import type { ProjectRow } from "@/lib/storage-helpers";
import { IMAGE_SOURCES_COLUMN_ID, LENS_FOUNDS_COLUMN_ID, SOURCE_URLS_COLUMN_ID } from "@/types";

/** A long description or spec sheet must reach the model whole. */
export const MAX_SOURCE_FIELD_CHARS = 4000;
/** Images sent with one row (Image Finder output, pasted image columns). */
export const MAX_SOURCE_IMAGES = 8;

const IMAGE_NAME_RE = /(^|[^a-z])(image|images|img|imgs|photo|photos|picture|pictures|thumbnail|thumbnails|packshot)([^a-z]|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
const URL_TOKEN_RE = /https?:\/\/[^\s,;|"'<>]+/gi;

/** Header names that hold product pictures, e.g. "Image Src", "Images", "photo_url". */
export function isImageColumnName(name: string): boolean {
  return IMAGE_NAME_RE.test(name);
}

/** All http(s) URLs in a cell that may hold one URL or a comma / newline / pipe separated list. */
export function splitUrlList(value: string): string[] {
  return value.match(URL_TOKEN_RE) ?? [];
}

/**
 * Image URLs in a plain (sheet) column. A column named like an image column
 * may use CDN URLs without a file extension; any other column only counts when
 * every URL in it looks like an image file.
 */
export function imageUrlsFromText(name: string, value: string): string[] {
  // Pictures pasted into the sheet are saved on upload; the job swaps each
  // reference for a link the model can open (see stored-images.ts).
  const stored = splitStoredImageRefs(value);
  if (stored.length > 0) return stored;
  const urls = splitUrlList(value);
  if (urls.length === 0) return [];
  if (isImageColumnName(name)) return urls;
  return urls.every((url) => IMAGE_EXT_RE.test(url)) ? urls : [];
}

/** Image URLs held by an AI column value (Image Finder output is `{ imageUrl }[]`). */
export function imageUrlsFromEnriched(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const item of value) {
    if (typeof item === "object" && item !== null) {
      const imageUrl = (item as { imageUrl?: unknown }).imageUrl;
      if (typeof imageUrl === "string" && /^https?:\/\//i.test(imageUrl)) urls.push(imageUrl);
    }
  }
  return urls;
}

function enrichedToText(val: unknown): string {
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (typeof item !== "object" || item === null) return String(item);
        const o = item as {
          uri?: string;
          pageUrl?: string;
          title?: string;
          question?: string;
          answer?: string;
        };
        if (o.question) return o.answer ? `${o.question} ${o.answer}` : o.question;
        const link = o.uri || o.pageUrl;
        // A found page reads best with its title: it often names the exact variant.
        if (link && o.title && o.title !== link) return `${o.title} (${link})`;
        return String(link || o.title || JSON.stringify(item));
      })
      .join(val.every((item) => typeof item === "string") ? "\n" : ", ");
  }
  return String(val);
}

/** Pages found by the Source URLs, Image sources and Lens founds columns. */
const PAGE_LIST_COLUMN_IDS = new Set([SOURCE_URLS_COLUMN_ID, IMAGE_SOURCES_COLUMN_ID, LENS_FOUNDS_COLUMN_ID]);

/** Pages held by a Source URLs / Image sources / Lens founds cell (`{ uri | pageUrl, title }[]`). */
export function knownPagesFromEnriched(value: unknown): KnownPage[] {
  if (!Array.isArray(value)) return [];
  const pages: KnownPage[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { uri?: unknown; pageUrl?: unknown; title?: unknown };
    const url = String(record.uri ?? record.pageUrl ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    pages.push(title && title !== url ? { url, title } : { url });
  }
  return pages;
}

export interface RowSources {
  /** Text fields for the model, keyed by column name. */
  productData: Record<string, string>;
  /** Images from selected image columns, deduped and capped, attached as vision input. */
  sourceImageUrls: string[];
  /** Pages from selected Source URLs / Image sources columns, deduped, in column order. */
  knownPages: KnownPage[];
}

export interface RowSourcesOptions {
  /** Keep page-list columns out of the text fields: the caller sends them as pages to open first. */
  pagesAsLeads?: boolean;
}

/**
 * The selected source columns of one row, split into what the model reads as
 * text and what it sees as images. Image columns from any tool (Image Finder
 * output, a pasted "Image Src" column) are attached as images instead of being
 * dumped as URL text. AI columns are named by their label (`custom_1` means
 * nothing to the model), falling back to the id when no label is known.
 */
export function buildRowSources(
  row: ProjectRow,
  sourceColumns: string[],
  enrichmentColumnIds: Set<string>,
  aiColumnLabels: Record<string, string> = {},
  options: RowSourcesOptions = {}
): RowSources {
  const productData: Record<string, string> = {};
  const images: string[] = [];
  const pages = new Map<string, KnownPage>();
  const sheetNames = new Set(Object.keys(row.originalData));

  for (const col of sourceColumns) {
    let text: string | undefined;
    let colImages: string[] = [];
    let name = col;

    // An AI column made in another tool (Image Finder, Categories, an earlier
    // Enrich run) is not part of this run's column list, so it is recognised
    // by holding data on the row while no sheet column has that name.
    const isAiColumn =
      enrichmentColumnIds.has(col) ||
      (row.originalData[col] === undefined && row.enrichedData?.[col] !== undefined);
    if (isAiColumn) {
      const val = row.enrichedData?.[col];
      if (val === undefined || val === null || val === "") continue;
      if (PAGE_LIST_COLUMN_IDS.has(col)) {
        for (const page of knownPagesFromEnriched(val)) if (!pages.has(page.url)) pages.set(page.url, page);
        if (options.pagesAsLeads) continue;
      }
      colImages = imageUrlsFromEnriched(val);
      text = colImages.length > 0 ? undefined : enrichedToText(val);
      const label = aiColumnLabels[col]?.trim();
      if (label) name = sheetNames.has(label) || label in productData ? `${label} (AI)` : label;
    } else {
      const val = row.originalData[col];
      if (val === undefined) continue;
      colImages = imageUrlsFromText(col, String(val));
      text = colImages.length > 0 ? undefined : String(val);
    }

    if (colImages.length > 0) {
      images.push(...colImages);
      productData[name] = `[${colImages.length} image${colImages.length === 1 ? "" : "s"} attached]`;
      continue;
    }
    if (text === undefined || text.trim() === "") continue;
    productData[name] = text.length > MAX_SOURCE_FIELD_CHARS ? text.slice(0, MAX_SOURCE_FIELD_CHARS) : text;
  }

  return {
    productData,
    sourceImageUrls: [...new Set(images)].slice(0, MAX_SOURCE_IMAGES),
    knownPages: [...pages.values()],
  };
}
