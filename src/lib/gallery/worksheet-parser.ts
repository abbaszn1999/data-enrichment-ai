import { parseExcelFile } from "@/lib/excel";
import { createEmptyWorksheet } from "@/lib/gallery/types";
import type { GalleryWorksheetJson } from "@/lib/gallery/types";
import { assertRowCount } from "@/lib/upload-limits";

function newRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function parseWorksheetFile(
  buffer: ArrayBuffer,
  sessionId: string
): Promise<GalleryWorksheetJson> {
  const { columns, rows } = await parseExcelFile(buffer);
  if (columns.length === 0 || columns.length > 250) {
    throw new Error("Worksheet must contain between 1 and 250 columns");
  }
  if (rows.length === 0) {
    throw new Error("Worksheet has no data rows");
  }
  assertRowCount(rows.length, "gallery");

  const galleryRows = rows.map((row, index) => ({
    id: newRowId(),
    rowIndex: index,
    originalData: Object.fromEntries(
      Object.entries(row.originalData || {}).map(([k, v]) => [
        k,
        String(v ?? "").slice(0, 20_000),
      ])
    ),
  }));

  return createEmptyWorksheet(sessionId, columns, galleryRows);
}
