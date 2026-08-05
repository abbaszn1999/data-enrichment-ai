import { parseExcelFile } from "@/lib/excel";
import { createEmptyVisualizerWorksheet } from "@/lib/visualizer/types";
import type { VisualizerWorksheetJson } from "@/lib/visualizer/types";

function newRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function parseVisualizerWorksheetFile(
  buffer: ArrayBuffer,
  sessionId: string
): Promise<VisualizerWorksheetJson> {
  const { columns, rows } = await parseExcelFile(buffer);
  if (columns.length === 0 || columns.length > 250) {
    throw new Error("Worksheet must contain between 1 and 250 columns");
  }
  if (rows.length > 10_000) {
    throw new Error("Worksheet cannot contain more than 10,000 rows");
  }

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
