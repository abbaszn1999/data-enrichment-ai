import ExcelJS from "exceljs";
import type { VisualizerWorksheetJson } from "@/lib/visualizer/types";

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

export async function buildVisualizerResultsBuffer(
  worksheet: VisualizerWorksheetJson,
  signedUrls: Record<string, string> = {}
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Descriptions");
  const headers = buildVisualizerResultsHeaders(worksheet);
  const imageCount = exportImageCount(worksheet);
  sheet.addRow(headers);

  for (const row of worksheet.rows) {
    const values: string[] = [];
    for (const column of worksheet.columns) {
      values.push(String(row.originalData[column] ?? ""));
    }
    values.push(String(row.generatedDescription ?? ""));
    for (let index = 1; index <= imageCount; index += 1) {
      const placeholder = row.imagePlaceholders?.find(
        (item) => item.index === index
      );
      const path = placeholder?.storagePath;
      values.push(
        path
          ? signedUrls[path] || (/^https?:\/\//i.test(path) ? path : path)
          : ""
      );
    }
    values.push(row.status);
    values.push(row.errorMessage ?? "");
    sheet.addRow(values);
  }

  sheet.getColumn(worksheet.columns.length + 1).width = 60;
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
