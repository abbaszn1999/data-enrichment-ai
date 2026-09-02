import type { ProductRow, EnrichedData, EnrichmentColumn } from "@/types";
import { enrichedValueToText } from "./export-values";

// --- Image extraction from xlsx ---

interface ImageAnchor {
  fromRow: number;
  fromCol: number;
  rId: string;
}

export type EmbeddedWorkbookImage = {
  sheetRow: number;
  bytes: Uint8Array;
  mime: string;
  ext: string;
};

export async function extractEmbeddedWorkbookImages(
  buffer: ArrayBuffer
): Promise<EmbeddedWorkbookImage[]> {
  const images: EmbeddedWorkbookImage[] = [];
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const rIdToFile = new Map<string, string>();
    const relPaths = [
      "xl/drawings/_rels/drawing1.xml.rels",
      "xl/drawings/_rels/drawing2.xml.rels",
    ];
    for (const relPath of relPaths) {
      const relsFile = zip.file(relPath);
      if (!relsFile) continue;
      const relsXml = await relsFile.async("text");
      const relRegex = /Relationship\s+Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = relRegex.exec(relsXml)) !== null) {
        const rId = match[1];
        let target = match[2];
        if (target.startsWith("../")) {
          target = "xl/" + target.slice(3);
        } else if (!target.startsWith("xl/")) {
          target = "xl/drawings/" + target;
        }
        rIdToFile.set(rId, target);
      }
    }
    if (rIdToFile.size === 0) return images;

    const anchors: ImageAnchor[] = [];
    const drawingPaths = ["xl/drawings/drawing1.xml", "xl/drawings/drawing2.xml"];
    for (const drawPath of drawingPaths) {
      const drawFile = zip.file(drawPath);
      if (!drawFile) continue;
      const drawXml = await drawFile.async("text");
      const anchorRegex =
        /<xdr:(?:twoCellAnchor|oneCellAnchor)[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
      let anchorMatch: RegExpExecArray | null;
      while ((anchorMatch = anchorRegex.exec(drawXml)) !== null) {
        const block = anchorMatch[1];
        const fromRowMatch = block.match(
          /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/
        );
        if (!fromRowMatch) continue;
        const blipMatch = block.match(/<a:blip[^>]*r:embed="(rId\d+)"/);
        if (!blipMatch) continue;
        anchors.push({
          fromRow: parseInt(fromRowMatch[1], 10),
          fromCol: parseInt(fromRowMatch[2], 10),
          rId: blipMatch[1],
        });
      }
    }

    for (const anchor of anchors) {
      const filePath = rIdToFile.get(anchor.rId);
      if (!filePath) continue;
      const imageFile = zip.file(filePath);
      if (!imageFile) continue;
      const bytes = new Uint8Array(await imageFile.async("uint8array"));
      const ext = filePath.split(".").pop()?.toLowerCase() || "png";
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
      };
      images.push({
        sheetRow: anchor.fromRow,
        bytes,
        mime: mimeMap[ext] || "image/png",
        ext: mimeMap[ext] ? ext.replace("jpeg", "jpg") : "png",
      });
    }
  } catch (e) {
    console.warn("Could not extract images from xlsx:", e);
  }
  return images;
}

function cellToString(cell: unknown): string {
  if (cell == null || cell === "") return "";
  if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
    return String(cell).trim();
  }
  if (typeof cell === "object") {
    const value = cell as {
      text?: string;
      result?: unknown;
      hyperlink?: string;
      richText?: Array<{ text?: string }>;
    };
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }
    if (value.text) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (value.hyperlink) return String(value.hyperlink).trim();
  }
  return String(cell).trim();
}

function parseCsvBuffer(buffer: ArrayBuffer): string[][] {
  const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value !== ""));
}

function isZipXlsx(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function sheetToRawRows(buffer: ArrayBuffer): Promise<string[][]> {
  if (!isZipXlsx(buffer)) {
    return parseCsvBuffer(buffer);
  }
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  if (zip.file("xl/vbaProject.bin")) {
    throw new Error("Macro-enabled workbooks (.xlsm) are not allowed.");
  }
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("The Excel file is empty.");
  }
  const rawData: string[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rawData.push(values.map((cell) => cellToString(cell)));
  });
  return rawData;
}

// --- Main parse function ---

export async function parseExcelFile(buffer: ArrayBuffer): Promise<{
  columns: string[];
  rows: ProductRow[];
  headerRowIndex: number;
}> {
  const rawData = await sheetToRawRows(buffer);

  if (rawData.length === 0) {
    throw new Error("The Excel file is empty.");
  }

  // Find the header row (the first row with the most string columns)
  let headerRowIndex = 0;
  let maxCols = 0;

  for (let i = 0; i < Math.min(20, rawData.length); i++) {
    const row = rawData[i];
    if (!row) continue;

    const validCells = row.filter((cell) => cell !== "").length;
    if (validCells > maxCols) {
      maxCols = validCells;
      headerRowIndex = i;
    }
  }

  const headers = (rawData[headerRowIndex] || []).map((cell, index) =>
    cell ? cell : `__EMPTY_${index}`
  );
  const jsonData: Record<string, string>[] = [];
  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i] || [];
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = String(row[index] ?? "").trim();
    });
    jsonData.push(record);
  }

  if (jsonData.length === 0) {
    throw new Error("No data rows found after the header.");
  }

  // Clean up columns (remove __EMPTY columns that have no data)
  let columns = Object.keys(jsonData[0] || {});
  columns = columns.filter(col => {
    if (!col.includes("__EMPTY")) return true;
    return jsonData.some(row => row[col] && String(row[col]).trim() !== "");
  });

  // Embedded pictures are extracted as binary and uploaded to Storage by the
  // products import path. Inlining them as data: URLs here would bloat the
  // catalog blob and the browser heap.
  const rows: ProductRow[] = jsonData
    .filter(row => {
      // Skip completely empty rows
      return columns.some(col => row[col] && String(row[col]).trim() !== "");
    })
    .map((row, index) => {
      const cleanData: Record<string, string> = {};
      columns.forEach(col => {
        const value = String(row[col] || "").trim();
        cleanData[col] = value.startsWith("data:image") ? "" : value;
      });

      return {
        id: `row-${index}`,
        rowIndex: index,
        selected: true,
        status: "pending" as const,
        originalData: cleanData,
        enrichedData: {},
      };
    });

  return { columns, rows, headerRowIndex };
}

export async function exportToExcel(
  rows: ProductRow[],
  originalColumns: string[],
  enrichmentColumns: EnrichmentColumn[],
  fileName: string
): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Enriched Data");

  const enabledEnrichment = enrichmentColumns.filter((col) => col.enabled);

  // Identify image columns
  const imageColNames = new Set<string>();
  for (const col of originalColumns) {
    const upper = col.toUpperCase();
    if (upper === "PICTURE" || upper === "IMAGE" || upper === "PHOTO") {
      imageColNames.add(col);
    }
  }

  // Build header row
  const allHeaders = [
    ...originalColumns,
    ...enabledEnrichment.map((col) => col.label),
  ];
  const headerRow = worksheet.addRow(allHeaders);
  headerRow.font = { bold: true, size: 11 };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;

  // Set column widths
  worksheet.columns = allHeaders.map((header, idx) => {
    const colName = idx < originalColumns.length ? originalColumns[idx] : "";
    if (imageColNames.has(colName)) {
      return { width: 15 };
    }
    return {
      width: header.length < 12 ? 14 : Math.min(header.length + 4, 50),
    };
  });

  // Add data rows
  for (const row of rows) {
    const values: (string | null)[] = [];
    const imageEntries: { colIdx: number; base64: string }[] = [];

    for (let i = 0; i < originalColumns.length; i++) {
      const col = originalColumns[i];
      const val = row.originalData[col] || "";

      if (imageColNames.has(col) && typeof val === "string" && val.startsWith("data:image/")) {
        values.push(null);
        imageEntries.push({ colIdx: i, base64: val });
      } else {
        const str = typeof val === "string" && val.length > 32700 ? val.substring(0, 32700) + "..." : val;
        values.push(str);
      }
    }

    for (const col of enabledEnrichment) {
      const strValue = enrichedValueToText(row.enrichedData[col.id], col.id);
      values.push(strValue.length > 32700 ? strValue.substring(0, 32700) + "..." : strValue);
    }

    const dataRow = worksheet.addRow(values);
    dataRow.alignment = { vertical: "middle", wrapText: true };

    // Add images to this row
    if (imageEntries.length > 0) {
      dataRow.height = 60;
      for (const img of imageEntries) {
        try {
          // Extract extension and base64 data
          const match = img.base64.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/);
          if (match) {
            const ext = match[1] === "jpg" ? "jpeg" : match[1];
            const rawBase64 = match[2];
            const imageId = workbook.addImage({
              base64: rawBase64,
              extension: ext as "png" | "jpeg" | "gif",
            });

            const rowNum = dataRow.number - 1; // 0-indexed
            worksheet.addImage(imageId, {
              tl: { col: img.colIdx, row: rowNum },
              ext: { width: 80, height: 55 },
            });
          }
        } catch {
          // If image fails, write placeholder text
          dataRow.getCell(img.colIdx + 1).value = "[Image]";
        }
      }
    }
  }

  // Style header
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF1E40AF" } },
    };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function addSheetRows(
  workbook: any,
  worksheet: any,
  rows: ProductRow[],
  originalColumns: string[],
  enrichmentColumns: EnrichmentColumn[],
) {
  const enabledEnrichment = enrichmentColumns.filter((col) => {
    return col.enabled || rows.some((r) => {
      const val = r.enrichedData?.[col.id];
      if (Array.isArray(val)) return val.length > 0;
      return val !== undefined && val !== null && val !== "";
    });
  });

  const imageColNames = new Set<string>();
  for (const col of originalColumns) {
    const upper = col.toUpperCase();
    if (upper === "PICTURE" || upper === "IMAGE" || upper === "PHOTO") {
      imageColNames.add(col);
    }
  }

  const allHeaders = [...originalColumns, ...enabledEnrichment.map((col) => col.label)];
  const headerRow = worksheet.addRow(allHeaders);
  headerRow.font = { bold: true, size: 11 };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;

  worksheet.columns = allHeaders.map((header: string, idx: number) => {
    const colName = idx < originalColumns.length ? originalColumns[idx] : "";
    if (imageColNames.has(colName)) return { width: 15 };
    return { width: header.length < 12 ? 14 : Math.min(header.length + 4, 50) };
  });

  for (const row of rows) {
    const values: (string | null)[] = [];
    const imageEntries: { colIdx: number; base64: string }[] = [];

    for (let i = 0; i < originalColumns.length; i++) {
      const col = originalColumns[i];
      const val = row.originalData[col] || "";
      if (imageColNames.has(col) && typeof val === "string" && val.startsWith("data:image/")) {
        values.push(null);
        imageEntries.push({ colIdx: i, base64: val });
      } else {
        values.push(typeof val === "string" && val.length > 32700 ? val.substring(0, 32700) + "..." : val);
      }
    }

    for (const col of enabledEnrichment) {
      const strValue = enrichedValueToText(row.enrichedData[col.id], col.id);
      values.push(strValue.length > 32700 ? strValue.substring(0, 32700) + "..." : strValue);
    }

    const dataRow = worksheet.addRow(values);
    dataRow.alignment = { vertical: "middle", wrapText: true };

    if (imageEntries.length > 0) {
      dataRow.height = 60;
      for (const img of imageEntries) {
        try {
          const match = img.base64.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/);
          if (match) {
            const ext = match[1] === "jpg" ? "jpeg" : match[1];
            const imageId = workbook.addImage({ base64: match[2], extension: ext as "png" | "jpeg" | "gif" });
            worksheet.addImage(imageId, { tl: { col: img.colIdx, row: dataRow.number - 1 }, ext: { width: 80, height: 55 } });
          }
        } catch {
          dataRow.getCell(img.colIdx + 1).value = "[Image]";
        }
      }
    }
  }

  headerRow.eachCell((cell: any) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.border = { bottom: { style: "thin", color: { argb: "FF1E40AF" } } };
  });
}

export async function exportToExcelTwoSheets(
  existingRows: ProductRow[],
  newRows: ProductRow[],
  originalColumns: string[],
  enrichmentColumns: EnrichmentColumn[],
): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  if (existingRows.length > 0) {
    const ws1 = workbook.addWorksheet("Existing");
    addSheetRows(workbook, ws1, existingRows, originalColumns, enrichmentColumns);
  }

  if (newRows.length > 0) {
    const ws2 = workbook.addWorksheet("New");
    addSheetRows(workbook, ws2, newRows, originalColumns, enrichmentColumns);
  }

  if (existingRows.length === 0 && newRows.length === 0) {
    workbook.addWorksheet("Empty");
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
