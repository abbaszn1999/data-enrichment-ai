import ExcelJS from "exceljs";
import type { GalleryWorksheetJson } from "@/lib/gallery/types";

export function buildGalleryExportHeaders(worksheet: GalleryWorksheetJson): string[] {
  const originalCols = worksheet.columns;
  const hasOriginal = !!worksheet.originalImageColumn;
  // Result columns first so users see them immediately
  const leading: string[] = [];
  if (!hasOriginal) leading.push("Main Image");
  leading.push("Gallery Images");
  return [...leading, ...originalCols];
}

export async function buildGalleryExportBuffer(
  worksheet: GalleryWorksheetJson,
  signedUrlForPath: (path: string) => Promise<string | null>
): Promise<Buffer> {
  const resolveImageUrl = (path: string) =>
    /^https?:\/\//i.test(path) ? Promise.resolve(path) : signedUrlForPath(path);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Gallery");

  const originalCols = worksheet.columns;
  const hasOriginal = !!worksheet.originalImageColumn;
  const headers = buildGalleryExportHeaders(worksheet);
  sheet.addRow(headers);

  for (const row of worksheet.rows) {
    const values: string[] = [];
    const mainPaths = row.mainImagePaths?.length
      ? row.mainImagePaths
      : row.mainImagePath
        ? [row.mainImagePath]
        : [];

    if (!hasOriginal) {
      values.push(mainPaths.map((path) => `__MAIN__:${path}`).join(" "));
    }

    const galleryTokens = row.galleryImagePaths.map((p) => `__G__:${p}`);
    values.push(galleryTokens.join(" "));

    for (const col of originalCols) {
      const raw = row.originalData[col] ?? "";
      if (
        hasOriginal &&
        col === worksheet.originalImageColumn &&
        !String(raw).trim() &&
        mainPaths.length > 0
      ) {
        values.push(mainPaths.map((path) => `__MAIN__:${path}`).join(" "));
      } else {
        values.push(String(raw));
      }
    }

    sheet.addRow(values);
  }

  for (let r = 2; r <= sheet.rowCount; r++) {
    const excelRow = sheet.getRow(r);
    for (let c = 1; c <= headers.length; c++) {
      const cell = excelRow.getCell(c);
      const text = String(cell.value ?? "");
      if (!text.includes("__MAIN__:") && !text.includes("__G__:")) continue;

      const parts = text.split(/\s+/).filter(Boolean);
      const urls: string[] = [];
      for (const part of parts) {
        if (part.startsWith("__MAIN__:") || part.startsWith("__G__:")) {
          const prefix = part.startsWith("__MAIN__:") ? "__MAIN__:" : "__G__:";
          const path = part.slice(prefix.length);
          const url = await resolveImageUrl(path);
          if (url) urls.push(url);
        } else {
          urls.push(part);
        }
      }
      cell.value = urls.join(",\n");
      cell.alignment = { wrapText: true, vertical: "top" };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
