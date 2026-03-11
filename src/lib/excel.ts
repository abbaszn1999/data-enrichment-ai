import * as XLSX from "xlsx";
import JSZip from "jszip";
import type { ProductRow, EnrichedData, EnrichmentColumn } from "@/types";

// --- Image extraction from xlsx ---

interface ImageAnchor {
  fromRow: number;
  fromCol: number;
  rId: string;
}

async function extractImagesFromXlsx(
  buffer: ArrayBuffer
): Promise<Map<number, string>> {
  // Map of rowIndex (0-based, data rows) -> base64 data URL
  const rowImages = new Map<number, string>();

  try {
    const zip = await JSZip.loadAsync(buffer);

    // 1. Find drawing relationship files to map rId -> image file paths
    const rIdToFile = new Map<string, string>();
    
    // Try multiple possible relationship file paths
    const relPaths = [
      "xl/drawings/_rels/drawing1.xml.rels",
      "xl/drawings/_rels/drawing2.xml.rels",
    ];
    
    for (const relPath of relPaths) {
      const relsFile = zip.file(relPath);
      if (!relsFile) continue;
      const relsXml = await relsFile.async("text");
      // Parse relationships: <Relationship Id="rId1" ... Target="../media/image1.png"/>
      const relRegex = /Relationship\s+Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
      let match;
      while ((match = relRegex.exec(relsXml)) !== null) {
        const rId = match[1];
        let target = match[2];
        // Normalize path
        if (target.startsWith("../")) {
          target = "xl/" + target.slice(3);
        } else if (!target.startsWith("xl/")) {
          target = "xl/drawings/" + target;
        }
        rIdToFile.set(rId, target);
      }
    }

    if (rIdToFile.size === 0) return rowImages;

    // 2. Parse drawing XML to find which row each image is anchored to
    const anchors: ImageAnchor[] = [];
    
    const drawingPaths = [
      "xl/drawings/drawing1.xml",
      "xl/drawings/drawing2.xml",
    ];

    for (const drawPath of drawingPaths) {
      const drawFile = zip.file(drawPath);
      if (!drawFile) continue;
      const drawXml = await drawFile.async("text");

      // Match twoCellAnchor or oneCellAnchor blocks
      // Extract <xdr:from><xdr:row>N</xdr:row><xdr:col>N</xdr:col></xdr:from> and <a:blip r:embed="rIdN"/>
      const anchorRegex = /<xdr:(?:twoCellAnchor|oneCellAnchor)[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
      let anchorMatch;

      while ((anchorMatch = anchorRegex.exec(drawXml)) !== null) {
        const block = anchorMatch[1];

        // Get from row/col
        const fromRowMatch = block.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/);
        if (!fromRowMatch) continue;

        const fromRow = parseInt(fromRowMatch[1], 10);
        const fromCol = parseInt(fromRowMatch[2], 10);

        // Get embedded image rId
        const blipMatch = block.match(/<a:blip[^>]*r:embed="(rId\d+)"/);
        if (!blipMatch) continue;

        anchors.push({ fromRow, fromCol, rId: blipMatch[1] });
      }
    }

    if (anchors.length === 0) return rowImages;

    // 3. Extract image binary data and create data URLs
    for (const anchor of anchors) {
      const filePath = rIdToFile.get(anchor.rId);
      if (!filePath) continue;

      const imageFile = zip.file(filePath);
      if (!imageFile) continue;

      const imageData = await imageFile.async("base64");
      
      // Detect mime type from extension
      const ext = filePath.split(".").pop()?.toLowerCase() || "png";
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        bmp: "image/bmp",
        webp: "image/webp",
        emf: "image/emf",
        wmf: "image/wmf",
        svg: "image/svg+xml",
      };
      const mime = mimeMap[ext] || "image/png";
      const dataUrl = `data:${mime};base64,${imageData}`;

      // anchor.fromRow is 0-based from the sheet (includes header row)
      rowImages.set(anchor.fromRow, dataUrl);
    }
  } catch (e) {
    console.warn("Could not extract images from xlsx:", e);
  }

  return rowImages;
}

// --- Main parse function ---

export async function parseExcelFile(buffer: ArrayBuffer): Promise<{
  columns: string[];
  rows: ProductRow[];
}> {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Get raw data as array of arrays to find the header row
  const rawData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
  
  if (rawData.length === 0) {
    throw new Error("The Excel file is empty.");
  }

  // Find the header row (the first row with the most string columns)
  let headerRowIndex = 0;
  let maxCols = 0;
  
  for (let i = 0; i < Math.min(20, rawData.length); i++) {
    const row = rawData[i];
    if (!row) continue;
    
    // Count non-empty string cells
    const validCells = row.filter(cell => typeof cell === "string" && cell.trim() !== "").length;
    if (validCells > maxCols) {
      maxCols = validCells;
      headerRowIndex = i;
    }
  }

  // Parse again, starting from the detected header row
  const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(
    worksheet,
    { range: headerRowIndex, defval: "", raw: false }
  );

  if (jsonData.length === 0) {
    throw new Error("No data rows found after the header.");
  }

  // Extract embedded images
  const imageMap = await extractImagesFromXlsx(buffer);

  // Clean up columns (remove __EMPTY columns that have no data)
  let columns = Object.keys(jsonData[0] || {});
  columns = columns.filter(col => {
    if (!col.includes("__EMPTY")) return true;
    // Keep it only if at least one row has data in it
    return jsonData.some(row => row[col] && String(row[col]).trim() !== "");
  });

  // Build rows
  const rows: ProductRow[] = jsonData
    .filter(row => {
      // Skip completely empty rows
      return columns.some(col => row[col] && String(row[col]).trim() !== "");
    })
    .map((row, index) => {
      // Only keep cleaned columns
      const cleanData: Record<string, string> = {};
      columns.forEach(col => {
        cleanData[col] = String(row[col] || "").trim();
      });

      // Assign image if present for this row
      // The sheet row = headerRowIndex + 1 + index (header is at headerRowIndex, data starts after)
      const sheetRow = headerRowIndex + 1 + index;
      const imageUrl = imageMap.get(sheetRow);
      if (imageUrl) {
        // Find the PICTURE column (case-insensitive) or any image-related column
        const pictureCol = columns.find(
          (c) => c.toUpperCase() === "PICTURE" || c.toUpperCase() === "IMAGE" || c.toUpperCase() === "PHOTO"
        );
        if (pictureCol) {
          cleanData[pictureCol] = imageUrl;
        } else {
          // Add a PICTURE column if images exist but no column for them
          if (!columns.includes("PICTURE")) {
            columns.push("PICTURE");
          }
          cleanData["PICTURE"] = imageUrl;
        }
      }

      return {
        id: `row-${index}`,
        rowIndex: index,
        selected: true,
        status: "pending" as const,
        originalData: cleanData,
        enrichedData: {},
      };
    });

  return { columns, rows };
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
      const value = row.enrichedData[col.id];
      let strValue = "";

      if (value === undefined || value === null) {
        strValue = "";
      } else if (Array.isArray(value)) {
        if (col.id === "sourceUrls") {
          strValue = (value as { title: string; uri: string }[])
            .map((s) => `${s.title}: ${s.uri}`)
            .join("\n");
        } else {
          strValue = (value as string[]).join("\n");
        }
      } else {
        strValue = String(value);
      }

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
