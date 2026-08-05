import type { GalleryWorksheetJson } from "@/lib/gallery/types";

/**
 * Pending image deletes must be scoped to a row. Gallery images often reuse
 * the same external URL across products; a path-only pending set would strip
 * that URL from every row during poll/merge.
 */
export function pendingImageDeleteKey(rowId: string, path: string): string {
  return `${rowId}\0${path}`;
}

/**
 * Re-apply in-flight optimistic deletes onto a freshly loaded worksheet so a
 * concurrent poll cannot revive an image mid-delete — but only for the row
 * that owns each pending delete.
 */
export function stripPendingImageDeletes(
  worksheet: GalleryWorksheetJson,
  pendingKeys: ReadonlySet<string>
): GalleryWorksheetJson {
  if (!pendingKeys.size) return worksheet;
  return {
    ...worksheet,
    rows: worksheet.rows.map((row) => {
      const isPending = (path: string) =>
        pendingKeys.has(pendingImageDeleteKey(row.id, path));
      const mainPaths = (
        Array.isArray(row.mainImagePaths)
          ? row.mainImagePaths
          : row.mainImagePath
            ? [row.mainImagePath]
            : []
      ).filter((item) => !isPending(item));
      return {
        ...row,
        mainImagePaths: mainPaths,
        mainImagePath: mainPaths[0] ?? null,
        galleryImagePaths: row.galleryImagePaths.filter(
          (item) => !isPending(item)
        ),
      };
    }),
  };
}
