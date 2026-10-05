import { imageUrlsFromEnriched, imageUrlsFromText, splitUrlList } from "@/lib/jobs/row-sources";
import { splitStoredImageRefs } from "@/lib/stored-image-ref";
import { PRODUCT_MODE_COLUMN_IDS } from "@/types";

interface LensRowLike {
  originalData: Record<string, unknown>;
  enrichedData?: Record<string, unknown>;
}

/** How many filled cells of a column are looked at when guessing whether it holds pictures. */
const DETECT_SAMPLE_SIZE = 40;
/** Share of the sampled cells that must hold a picture for the column to count as an image column. */
const DETECT_MIN_SHARE = 0.5;

/**
 * Pictures in a cell the user picked as the image column: pasted sheet pictures
 * first, else every http(s) link in it (a picked column is trusted, so a CDN
 * link without a file extension counts).
 */
export function lensImagesFromCell(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const text = String(value);
  const stored = splitStoredImageRefs(text);
  if (stored.length > 0) return stored;
  return splitUrlList(text);
}

/** The one picture Lens searches with for a row: the first in the picked column. */
export function lensImageForRow(row: LensRowLike, column: string): string | null {
  const fromSheet = row.originalData[column];
  if (fromSheet !== undefined) return lensImagesFromCell(fromSheet)[0] ?? null;
  const fromAi = row.enrichedData?.[column];
  if (fromAi === undefined || fromAi === null) return null;
  const images = imageUrlsFromEnriched(fromAi);
  if (images.length > 0) return images[0];
  return lensImagesFromCell(fromAi)[0] ?? null;
}

/** Every text cell of the sheet row except the picture column, for ranking Lens pages against the row. */
export function lensRowText(row: LensRowLike, pictureColumn: string | undefined): Record<string, string> {
  const text: Record<string, string> = {};
  for (const [column, value] of Object.entries(row.originalData)) {
    if (column === pictureColumn || value === undefined || value === null) continue;
    text[column] = String(value);
  }
  return text;
}

/**
 * The first column that looks like it holds the product pictures: a sheet
 * column where most filled cells hold a pasted picture or an image link, then
 * the Image URLs column Image Finder wrote. Null when nothing looks like one.
 */
export function detectLensImageColumn(
  rows: readonly LensRowLike[],
  originalColumns: readonly string[],
  aiColumnIds: readonly string[] = []
): string | null {
  for (const column of originalColumns) {
    let filled = 0;
    let withImage = 0;
    for (const row of rows) {
      const raw = row.originalData[column];
      if (raw === undefined || raw === null) continue;
      const text = String(raw).trim();
      if (!text) continue;
      filled += 1;
      if (imageUrlsFromText(column, text).length > 0) withImage += 1;
      if (filled >= DETECT_SAMPLE_SIZE) break;
    }
    if (filled > 0 && withImage / filled >= DETECT_MIN_SHARE) return column;
  }
  const imageFinder = PRODUCT_MODE_COLUMN_IDS.images;
  if (aiColumnIds.includes(imageFinder)) return imageFinder;
  return null;
}
