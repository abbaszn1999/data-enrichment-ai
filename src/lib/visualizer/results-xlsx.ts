import type { VisualizerWorksheetJson } from "@/lib/visualizer/types";
import { serializeTableExport, type TableExport } from "@/lib/export/table-file";

function exportImageCount(worksheet: VisualizerWorksheetJson): number {
  const maxPlaceholders = Math.max(
    0,
    ...worksheet.rows.flatMap((row) =>
      (row.imagePlaceholders ?? []).map((item) => item.index)
    ),
    worksheet.settings.description.imageCount ||
      worksheet.settings.description.maxPlaceholders ||
      0
  );
  return Math.min(6, Math.max(1, maxPlaceholders || 4));
}

/** Export headers: product columns + AI description + image URLs (no prompt briefs). */
export function buildVisualizerResultsHeaders(
  worksheet: VisualizerWorksheetJson
): string[] {
  const count = exportImageCount(worksheet);
  const imageUrlHeaders = Array.from(
    { length: count },
    (_, index) => `Image ${index + 1} URL`
  );
  return [
    ...worksheet.columns,
    "AI Description",
    ...imageUrlHeaders,
    "Status",
    "Error",
  ];
}

/** Flat results table; `rowIds` limits the rows (sheet order is kept). */
export function buildVisualizerResultsTable(
  worksheet: VisualizerWorksheetJson,
  signedUrls: Record<string, string> = {},
  rowIds?: Set<string>
): TableExport {
  const imageCount = exportImageCount(worksheet);
  const rows = rowIds
    ? worksheet.rows.filter((row) => rowIds.has(row.id))
    : worksheet.rows;
  return {
    sheetName: "Descriptions",
    headers: buildVisualizerResultsHeaders(worksheet),
    rows: rows.map((row) => {
      const values = worksheet.columns.map((column) => String(row.originalData[column] ?? ""));
      values.push(String(row.generatedDescription ?? ""));
      for (let index = 1; index <= imageCount; index += 1) {
        const path = row.imagePlaceholders?.find((item) => item.index === index)?.storagePath;
        values.push(path ? signedUrls[path] || path : "");
      }
      values.push(row.status, row.errorMessage ?? "");
      return values;
    }),
  };
}

export async function buildVisualizerResultsBuffer(
  worksheet: VisualizerWorksheetJson,
  signedUrls: Record<string, string> = {}
): Promise<Buffer> {
  const { buffer } = await serializeTableExport(
    buildVisualizerResultsTable(worksheet, signedUrls),
    "xlsx"
  );
  return buffer;
}
