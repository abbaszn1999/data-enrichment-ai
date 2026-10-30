import { promises as fs } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { csvField } from "../../../src/lib/store-agent/csv";

/**
 * Attachments the agent cannot read as text (Excel, PDF) are turned into
 * files it can: each sheet becomes a CSV, with the pictures placed on its rows
 * saved as images and listed in an "image" column; a PDF becomes its text.
 * The panel shows those files too (a table with the pictures in their rows).
 */

const MAX_ROWS = 50_000;
const MAX_COLS = 200;
const MAX_IMAGES = 2_000;
const MAX_PDF_PAGES = 300;

export type Conversion = { made: string[]; note: string };

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().replace(/T00:00:00\.000Z$/, "");
  if (typeof value !== "object") return String(value);
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.richText)) return (v.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
  if ("result" in v) return cellText(v.result);
  if (typeof v.text === "string" || typeof v.hyperlink === "string") return String(v.text || v.hyperlink);
  if (typeof v.error === "string") return v.error;
  return "";
};

const safeName = (s: string) => s.replace(/[^\w.\- ()؀-ۿ]+/g, "_").slice(0, 80) || "sheet";

async function convertWorkbook(cwd: string, relative: string): Promise<Conversion> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(cwd, ...relative.split("/")));
  const base = relative.replace(/\.[^./]+$/, "");
  const imagesDir = `${base}-images`;
  const sheets = workbook.worksheets.filter((ws) => ws.actualRowCount > 0);
  const made: string[] = [];
  const lines: string[] = [];
  const savedImages = new Map<string, string>();
  let imageCount = 0;

  const saveImage = async (imageId: string): Promise<string | null> => {
    const known = savedImages.get(imageId);
    if (known) return known;
    if (imageCount >= MAX_IMAGES) return null;
    const image = workbook.getImage(Number(imageId));
    if (!image?.buffer) return null;
    const file = `${imagesDir}/${safeName(imageId)}.${image.extension === "jpeg" ? "jpg" : image.extension}`;
    const local = path.join(cwd, ...file.split("/"));
    await fs.mkdir(path.dirname(local), { recursive: true });
    await fs.writeFile(local, image.buffer as unknown as Uint8Array);
    savedImages.set(imageId, file);
    imageCount += 1;
    return file;
  };

  for (const ws of sheets) {
    const rows: string[][] = [];
    const lastRow = Math.min(ws.rowCount, MAX_ROWS);
    const lastCol = Math.min(ws.columnCount, MAX_COLS);
    for (let r = 1; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= lastCol; c++) cells.push(cellText(row.getCell(c).value).replace(/\r\n?/g, "\n"));
      rows.push(cells);
    }
    const header = rows.findIndex((r) => r.some((c) => c.trim()));
    if (header < 0) continue;
    const width = Math.max(1, ...rows.map((r) => r.reduce((w, c, i) => (c.trim() ? i + 1 : w), 0)));

    // Pictures floating over the sheet, by the row their top-left corner sits on.
    const byRow = new Map<number, string[]>();
    for (const img of ws.getImages()) {
      const r = Math.floor(img.range.tl.nativeRow ?? img.range.tl.row);
      if (r <= header) continue;
      const file = await saveImage(String(img.imageId));
      if (file) byRow.set(r, [...(byRow.get(r) ?? []), file]);
    }

    const columns = rows[header]!.slice(0, width).map((c, i) => c.trim() || `column ${i + 1}`);
    const data = rows.slice(header + 1).filter((r) => r.some((c) => c.trim()));
    const withImages = byRow.size > 0;
    const out = [withImages ? ["image", ...columns] : columns];
    rows.slice(header + 1).forEach((r, i) => {
      if (!r.some((c) => c.trim()) && !byRow.has(header + 1 + i)) return;
      const cells = r.slice(0, width);
      out.push(withImages ? [(byRow.get(header + 1 + i) ?? []).join(" | "), ...cells] : cells);
    });
    const csv = `${sheets.length === 1 ? base : `${base} - ${safeName(ws.name)}`}.csv`;
    await fs.writeFile(path.join(cwd, ...csv.split("/")), out.map((r) => r.map(csvField).join(",")).join("\n"), "utf8");
    made.push(csv);
    lines.push(
      `${csv} (sheet "${ws.name}": ${data.length} rows, ${columns.length} columns` +
        (withImages ? `; the "image" column gives each row's picture, saved under ${imagesDir}/` : "") +
        (ws.rowCount > MAX_ROWS ? `; only the first ${MAX_ROWS} rows` : "") +
        ")"
    );
  }

  // Pictures not placed on a data row (a logo, or pictures stored inside cells).
  const media = ((workbook.model as { media?: Array<{ type?: string }> }).media ?? []).filter((m) => !m.type || m.type === "image");
  const unplaced = media.length - savedImages.size;
  if (unplaced > 0) {
    for (let id = 0; id < media.length && imageCount < MAX_IMAGES; id++) await saveImage(String(id));
  }
  made.push(...savedImages.values());

  if (!lines.length) return { made, note: `${relative}: an Excel workbook with no data.` };
  return {
    made,
    note:
      `${relative} is an Excel workbook, which cannot be read as text, so it was converted: ${lines.join("; ")}.` +
      (unplaced > 0 ? ` ${unplaced} more picture(s) were not on a data row; they are in ${imagesDir}/.` : "") +
      ` Work from the .csv. To show it to the user, show_file the .csv: the panel shows it as a table with the pictures in their rows.`,
  };
}

async function convertPdf(cwd: string, relative: string): Promise<Conversion> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const bytes = await fs.readFile(path.join(cwd, ...relative.split("/")));
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = text.slice(0, MAX_PDF_PAGES);
  const body = pages.map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`).join("\n\n");
  if (!pages.some((t) => t.trim())) {
    return { made: [], note: `${relative} is a PDF of ${totalPages} page(s) with no text in it (a scan or pictures), so its text cannot be read. Tell the user.` };
  }
  const txt = `${relative.replace(/\.[^./]+$/, "")}.txt`;
  await fs.writeFile(path.join(cwd, ...txt.split("/")), body, "utf8");
  return {
    made: [txt],
    note: `${relative} is a PDF (${totalPages} pages); its text is in ${txt}${totalPages > MAX_PDF_PAGES ? ` (first ${MAX_PDF_PAGES} pages)` : ""}. Read that file.`,
  };
}

/** Convert an attachment the agent cannot read as it is. Null when it can already. */
export async function convertAttachment(cwd: string, relative: string): Promise<Conversion | null> {
  const ext = path.extname(relative).toLowerCase();
  try {
    if (ext === ".xlsx" || ext === ".xlsm") return await convertWorkbook(cwd, relative);
    if (ext === ".pdf") return await convertPdf(cwd, relative);
    if (ext === ".xls") {
      return {
        made: [],
        note: `${relative} is in the old Excel format (.xls), which cannot be read. Ask the user to save it as .xlsx or .csv and attach it again.`,
      };
    }
  } catch (error) {
    return { made: [], note: `${relative} could not be opened (${(error as Error).message.slice(0, 200)}). Tell the user and ask for a .csv or .xlsx copy.` };
  }
  return null;
}
