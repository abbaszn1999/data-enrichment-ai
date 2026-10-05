import { parseExcelFile } from "@/lib/excel";
import { attachSheetImages, extractSheetImages, type SheetImage } from "@/lib/sheet-images";
import { createEmptyVisualizerWorksheet } from "@/lib/visualizer/types";
import type { VisualizerWorksheetJson } from "@/lib/visualizer/types";
import { assertRowCount } from "@/lib/upload-limits";

function newRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function parseVisualizerWorksheetFile(
  buffer: ArrayBuffer,
  sessionId: string,
  options: {
    /** Saves a picture found inside the sheet and returns its Storage path. */
    storePicture?: (image: SheetImage) => Promise<string>;
  } = {}
): Promise<VisualizerWorksheetJson> {
  const parsed = await parseExcelFile(buffer);
  let { columns } = parsed;
  let rows = parsed.rows;
  if (options.storePicture) {
    const images = await extractSheetImages(buffer);
    if (images.length > 0) {
      const attached = await attachSheetImages({ images, parsed, upload: options.storePicture });
      if (attached.imageCount > 0) {
        columns = attached.columns;
        rows = rows.map((row, index) => ({ ...row, originalData: attached.rows[index] }));
      }
    }
  }
  if (columns.length === 0 || columns.length > 250) {
    throw new Error("Worksheet must contain between 1 and 250 columns");
  }
  if (rows.length === 0) {
    throw new Error("Worksheet has no data rows");
  }
  assertRowCount(rows.length, "visualizer");

  const visualizerRows = rows.map((row, index) => ({
    id: newRowId(),
    rowIndex: index,
    originalData: Object.fromEntries(
      Object.entries(row.originalData || {}).map(([key, value]) => [
        key,
        String(value ?? "").slice(0, 20_000),
      ])
    ),
  }));

  return createEmptyVisualizerWorksheet(sessionId, columns, visualizerRows);
}
