import type { GalleryWorksheetJson } from "@/lib/gallery/types";
import { mapLimit } from "@/lib/async/map-limit";
import type { TableExport } from "@/lib/export/table-file";

export function buildGalleryExportHeaders(worksheet: GalleryWorksheetJson): string[] {
  const originalCols = worksheet.columns;
  const hasOriginal = !!worksheet.originalImageColumn;
  // Result columns first so users see them immediately
  const leading: string[] = [];
  if (!hasOriginal) leading.push("Main Image");
  leading.push("Gallery Images");
  return [...leading, ...originalCols];
}

function rowMainPaths(row: GalleryWorksheetJson["rows"][number]): string[] {
  if (row.mainImagePaths?.length) return row.mainImagePaths;
  return row.mainImagePath ? [row.mainImagePath] : [];
}

/**
 * Flat export table for the Gallery sheet. Storage image paths are resolved to
 * shareable URLs; `rowIds` limits the rows (sheet order is kept).
 */
export async function buildGalleryExportTable(
  worksheet: GalleryWorksheetJson,
  signedUrlForPath: (path: string) => Promise<string | null>,
  rowIds?: Set<string>
): Promise<TableExport> {
  const hasOriginal = !!worksheet.originalImageColumn;
  const headers = buildGalleryExportHeaders(worksheet);
  const rows = rowIds
    ? worksheet.rows.filter((row) => rowIds.has(row.id))
    : worksheet.rows;

  const uniquePaths = new Set<string>();
  for (const row of rows) {
    for (const path of [...rowMainPaths(row), ...row.galleryImagePaths]) uniquePaths.add(path);
  }
  const signed = new Map<string, string | null>();
  await mapLimit([...uniquePaths], 20, async (path) => {
    signed.set(path, /^https?:\/\//i.test(path) ? path : await signedUrlForPath(path));
    return path;
  });
  const urls = (paths: string[]) =>
    paths.map((path) => signed.get(path)).filter(Boolean).join(",\n");

  return {
    sheetName: "Gallery",
    headers,
    rows: rows.map((row) => {
      const mainPaths = rowMainPaths(row);
      const values: string[] = [];
      if (!hasOriginal) values.push(urls(mainPaths));
      values.push(urls(row.galleryImagePaths));
      for (const col of worksheet.columns) {
        const raw = String(row.originalData[col] ?? "");
        values.push(
          hasOriginal && col === worksheet.originalImageColumn && !raw.trim() && mainPaths.length > 0
            ? urls(mainPaths)
            : raw
        );
      }
      return values;
    }),
  };
}
