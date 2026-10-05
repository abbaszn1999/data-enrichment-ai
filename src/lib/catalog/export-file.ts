import { enrichedValueToJson, enrichedValueToText } from "@/lib/export-values";
import { hasStoredImageRef, splitStoredImageRefs, storedImagePath } from "@/lib/stored-image-ref";
import type { ProductRow } from "@/types";

export type ExportFormat = "xlsx" | "csv" | "json";

export type ExportColumn = {
  /** Original sheet column name, or enrichment column id. */
  key: string;
  label: string;
  source: "original" | "enriched";
};

export type ExportSection = { name: string; rows: ProductRow[] };

export type ExportProgress = {
  done: number;
  total: number;
  phase: "rows" | "packaging";
};

export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelledError";
  }
}

const EXCEL_CELL_LIMIT = 32_700;
const YIELD_EVERY = 250;

const MIME: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv;charset=utf-8",
  json: "application/json",
};

/** Pictures saved from the uploaded sheet, resolved once per export. */
type StoredPictures = {
  links: Map<string, string>;
  files: Map<string, { base64: string; ext: "png" | "jpeg" | "gif" }>;
};

const EXPORT_LINK_TTL_SEC = 7 * 24 * 60 * 60;
const PICTURE_FETCH_CONCURRENCY = 6;

function withPictureLinks(value: string, pictures: StoredPictures): string {
  if (!hasStoredImageRef(value)) return value;
  return value.replace(/vz-storage:[^\s,;|"'<>]+/gi, (ref) => pictures.links.get(storedImagePath(ref)) ?? "");
}

function textValue(row: ProductRow, column: ExportColumn, pictures: StoredPictures): string {
  if (column.source === "enriched") {
    return enrichedValueToText(row.enrichedData?.[column.key], column.key);
  }
  const value = row.originalData?.[column.key] ?? "";
  return value.startsWith("data:image/") ? "[image]" : withPictureLinks(value, pictures);
}

function jsonValue(row: ProductRow, column: ExportColumn, pictures: StoredPictures): unknown {
  if (column.source === "enriched") {
    return enrichedValueToJson(row.enrichedData?.[column.key], column.key);
  }
  const value = row.originalData?.[column.key] ?? "";
  return value.startsWith("data:image/") ? "[image]" : withPictureLinks(value, pictures);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * xlsx gets the pictures themselves, csv and json get time-limited links
 * (a text file cannot hold a picture).
 */
async function resolveStoredPictures(
  format: ExportFormat,
  sections: ExportSection[],
  columns: ExportColumn[]
): Promise<StoredPictures> {
  const pictures: StoredPictures = { links: new Map(), files: new Map() };
  const paths = new Set<string>();
  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of columns) {
        if (column.source !== "original") continue;
        for (const ref of splitStoredImageRefs(row.originalData?.[column.key] ?? "")) {
          paths.add(storedImagePath(ref));
        }
      }
    }
  }
  if (paths.size === 0) return pictures;

  const { getImageSignedUrl, downloadStoredImage } = await import("@/lib/storage-helpers");
  const queue = [...paths];
  const worker = async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      if (format === "xlsx") {
        const blob = await downloadStoredImage(path).catch(() => null);
        if (!blob) continue;
        const ext = /png/i.test(blob.type) ? "png" : /gif/i.test(blob.type) ? "gif" : "jpeg";
        pictures.files.set(path, { base64: await blobToBase64(blob), ext });
      } else {
        const link = await getImageSignedUrl(path, EXPORT_LINK_TTL_SEC).catch(() => null);
        if (link) pictures.links.set(path, link);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PICTURE_FETCH_CONCURRENCY, paths.size) }, worker));
  return pictures;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Builds the export file row by row, yielding to the browser so the progress
 * UI can paint and a cancel request can land between chunks.
 */
export async function buildCatalogExport(params: {
  format: ExportFormat;
  sections: ExportSection[];
  columns: ExportColumn[];
  onProgress?: (progress: ExportProgress) => void;
  isCancelled?: () => boolean;
}): Promise<Blob> {
  const { format, columns, onProgress, isCancelled } = params;
  const sections = params.sections.filter((section) => section.rows.length > 0);
  const total = sections.reduce((sum, section) => sum + section.rows.length, 0);
  let done = 0;

  const tick = async () => {
    done += 1;
    if (done % YIELD_EVERY === 0 || done === total) {
      onProgress?.({ done, total, phase: "rows" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (isCancelled?.()) throw new ExportCancelledError();
    }
  };

  onProgress?.({ done: 0, total, phase: "rows" });
  const pictures = await resolveStoredPictures(format, sections, columns);

  if (format === "csv") {
    // Multiple sections share one table, told apart by a leading "Sheet" column.
    const withSheet = sections.length > 1;
    const header = [...(withSheet ? ["Sheet"] : []), ...columns.map((c) => c.label)];
    const lines = [header.map(csvCell).join(",")];
    for (const section of sections) {
      for (const row of section.rows) {
        const cells = columns.map((column) => csvCell(textValue(row, column, pictures)));
        lines.push([...(withSheet ? [csvCell(section.name)] : []), ...cells].join(","));
        await tick();
      }
    }
    onProgress?.({ done: total, total, phase: "packaging" });
    // BOM so Excel opens UTF-8 (Arabic, accents) correctly.
    return new Blob(["\uFEFF" + lines.join("\r\n")], { type: MIME.csv });
  }

  if (format === "json") {
    const bySection: Record<string, Record<string, unknown>[]> = {};
    for (const section of sections) {
      const items: Record<string, unknown>[] = [];
      for (const row of section.rows) {
        const item: Record<string, unknown> = {};
        for (const column of columns) item[column.label] = jsonValue(row, column, pictures);
        items.push(item);
        await tick();
      }
      bySection[section.name.toLowerCase()] = items;
    }
    onProgress?.({ done: total, total, phase: "packaging" });
    const payload = sections.length > 1 ? bySection : Object.values(bySection)[0] ?? [];
    return new Blob([JSON.stringify(payload, null, 2)], { type: MIME.json });
  }

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  for (const section of sections) {
    const sheet = workbook.addWorksheet(section.name);
    const headerRow = sheet.addRow(columns.map((c) => c.label));
    headerRow.height = 22;
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.border = { bottom: { style: "thin", color: { argb: "FF1E40AF" } } };
    });
    sheet.columns = columns.map((c) => ({
      width: c.label.length < 12 ? 14 : Math.min(c.label.length + 4, 50),
    }));
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    for (const row of section.rows) {
      const images: { col: number; base64: string; ext: "png" | "jpeg" | "gif" }[] = [];
      const values = columns.map((column, index) => {
        if (column.source === "original") {
          const raw = row.originalData?.[column.key] ?? "";
          const stored = splitStoredImageRefs(raw)
            .map((ref) => pictures.files.get(storedImagePath(ref)))
            .find(Boolean);
          if (stored) {
            images.push({ col: index, base64: stored.base64, ext: stored.ext });
            return null;
          }
          const match = raw.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/);
          if (match) {
            images.push({
              col: index,
              base64: match[2],
              ext: match[1] === "jpg" ? "jpeg" : (match[1] as "png" | "jpeg" | "gif"),
            });
            return null;
          }
        }
        const text = textValue(row, column, pictures);
        return text.length > EXCEL_CELL_LIMIT ? `${text.slice(0, EXCEL_CELL_LIMIT)}...` : text;
      });
      const dataRow = sheet.addRow(values);
      dataRow.alignment = { vertical: "top", wrapText: true };
      if (images.length > 0) {
        dataRow.height = 60;
        for (const image of images) {
          try {
            const imageId = workbook.addImage({ base64: image.base64, extension: image.ext });
            sheet.addImage(imageId, {
              tl: { col: image.col, row: dataRow.number - 1 },
              ext: { width: 80, height: 55 },
            });
          } catch {
            dataRow.getCell(image.col + 1).value = "[image]";
          }
        }
      }
      await tick();
    }
  }
  if (sections.length === 0) workbook.addWorksheet("Empty");

  onProgress?.({ done: total, total, phase: "packaging" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (isCancelled?.()) throw new ExportCancelledError();
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: MIME.xlsx });
}
