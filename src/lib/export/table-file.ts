/**
 * Serializes a flat table (headers + string rows) to xlsx / csv / json, and
 * parses the shared export request options (format, row ids, columns) used by
 * the Gallery and Visualizer export routes.
 */

export type TableExportFormat = "xlsx" | "csv" | "json";

export type TableExport = {
  sheetName: string;
  headers: string[];
  rows: string[][];
};

export type TableExportOptions = {
  format: TableExportFormat;
  /** Only these row ids, in sheet order. Omitted → every row. */
  rowIds?: Set<string>;
  /** Only these headers, in sheet order. Omitted → every column. */
  columns?: Set<string>;
};

const CONTENT_TYPES: Record<TableExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

const EXCEL_CELL_LIMIT = 32_700;

export function parseTableExportOptions(body: {
  format?: unknown;
  rowIds?: unknown;
  columns?: unknown;
}): TableExportOptions {
  const format: TableExportFormat =
    body.format === "csv" || body.format === "json" ? body.format : "xlsx";
  const toSet = (value: unknown) =>
    Array.isArray(value) ? new Set(value.map(String)) : undefined;
  return { format, rowIds: toSet(body.rowIds), columns: toSet(body.columns) };
}

/** Keeps only the requested columns (by header), preserving sheet order. */
export function selectTableColumns(table: TableExport, columns?: Set<string>): TableExport {
  if (!columns) return table;
  const keep = table.headers
    .map((header, index) => (columns.has(header) ? index : -1))
    .filter((index) => index >= 0);
  return {
    ...table,
    headers: keep.map((index) => table.headers[index]),
    rows: table.rows.map((row) => keep.map((index) => row[index] ?? "")),
  };
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function serializeTableExport(
  table: TableExport,
  format: TableExportFormat
): Promise<{ buffer: Buffer; contentType: string; extension: TableExportFormat }> {
  const contentType = CONTENT_TYPES[format];

  if (format === "csv") {
    const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(","));
    // BOM so Excel opens UTF-8 (Arabic, accents) correctly.
    return { buffer: Buffer.from("\uFEFF" + lines.join("\r\n"), "utf8"), contentType, extension: format };
  }

  if (format === "json") {
    const items = table.rows.map((row) =>
      Object.fromEntries(table.headers.map((header, index) => [header, row[index] ?? ""]))
    );
    return { buffer: Buffer.from(JSON.stringify(items, null, 2), "utf8"), contentType, extension: format };
  }

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.sheetName.slice(0, 31) || "Sheet1");
  const headerRow = sheet.addRow(table.headers);
  headerRow.height = 22;
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.border = { bottom: { style: "thin", color: { argb: "FF1E40AF" } } };
  });
  sheet.columns = table.headers.map((header) => ({
    width: header.length < 12 ? 16 : Math.min(header.length + 4, 60),
  }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of table.rows) {
    const dataRow = sheet.addRow(
      row.map((value) =>
        value.length > EXCEL_CELL_LIMIT ? `${value.slice(0, EXCEL_CELL_LIMIT)}...` : value
      )
    );
    dataRow.alignment = { vertical: "top", wrapText: true };
  }
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, contentType, extension: format };
}
