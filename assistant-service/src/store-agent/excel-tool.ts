import { lookup } from "node:dns/promises";
import { promises as fs } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import type { SDKCustomTool } from "@cursor/sdk";
import ExcelJS from "exceljs";
import { parseCsv } from "../../../src/lib/store-agent/csv";
import { cellImages } from "../../../src/lib/store-agent/file-kinds";
import { convertWorkbook } from "./attachments";
import { resolveConfined } from "./file-tools";

/**
 * Excel workbooks the user can download, made from tables in the chat folder,
 * with each row's picture placed in its row. Pictures come from the folder or
 * from public https links; never from the service's own network.
 */

const MAX_SHEETS = 10;
const MAX_ROWS = 20_000;
const MAX_IMAGES = 1_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_ROW_POINTS = 60;
const IMAGE_COL_CHARS = 12;
const DOWNLOADS_AT_ONCE = 6;

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failure = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: true as const });

type Table = { columns: string[]; rows: string[][] };

/** A .csv, or a .json array of objects, as columns and rows of text. */
export async function readTable(file: string): Promise<Table> {
  const body = await fs.readFile(file, "utf8");
  if (/\.json$/i.test(file)) {
    const data = JSON.parse(body) as unknown;
    if (!Array.isArray(data) || !data.every((r) => r && typeof r === "object")) throw new Error(`${path.basename(file)} is not a JSON array of objects.`);
    const columns = Array.from(new Set((data as object[]).flatMap((r) => Object.keys(r))));
    const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    return { columns, rows: (data as Array<Record<string, unknown>>).map((r) => columns.map((c) => cell(r[c]))) };
  }
  const parsed = parseCsv(body, /\.tsv$/i.test(file) ? "\t" : ",");
  if (!parsed.length) throw new Error(`${path.basename(file)} is empty.`);
  return { columns: parsed[0]!, rows: parsed.slice(1) };
}

/** The picture format from its first bytes; Excel files hold PNG, JPEG and GIF. */
export function imageFormat(bytes: Uint8Array): "png" | "jpeg" | "gif" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  return null;
}

/** Private, loopback, link-local (cloud metadata) and other non-public addresses. */
export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPublicAddress(v6.slice(7));
  return !(v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff"));
}

/** An https link to a public site: never the service's own network. */
export async function publicImageUrl(value: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((a) => a.address)).catch(() => []);
  return addresses.length && addresses.every(isPublicAddress) ? url : null;
}

async function loadImage(root: string, value: string): Promise<Uint8Array | string> {
  const first = cellImages(value)[0];
  if (!first) return "empty";
  let bytes: Uint8Array;
  if (/^https?:\/\//i.test(first)) {
    const url = await publicImageUrl(first);
    if (!url) return "not a public https link";
    // No redirects: one could lead to an address that was not checked.
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) return "could not be downloaded";
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return "too large";
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    try {
      bytes = new Uint8Array(await fs.readFile(await resolveConfined(root, first, { mustExist: true })));
    } catch {
      return "not found in the folder";
    }
  }
  if (bytes.length > MAX_IMAGE_BYTES) return "too large";
  return imageFormat(bytes) ? bytes : "not PNG, JPEG or GIF";
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

export function createExcelTool(root: string, onWrite: (relative: string, sources: string[], folder?: string) => void): Record<string, SDKCustomTool> {
  return {
    make_excel: {
      description:
        "Make an Excel workbook (.xlsx) for the user to download, from tables in your folder (.csv, or .json arrays of objects): one sheet per table. " +
        "Give image_column to put each row's picture in its row: that column holds image files from your folder or https links to images. " +
        "The user sees it in the panel with its sheets and pictures, and can download it. " +
        "Set folder to \"reports\" when it is your analysis or comparison; data from the store goes to Store data by itself.",
      inputSchema: {
        type: "object",
        properties: {
          sources: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_SHEETS, description: "Tables in your folder, one sheet each." },
          output: { type: "string", description: "Where to write the workbook, ending in .xlsx (e.g. reports/products.xlsx)." },
          sheet_names: { type: "array", items: { type: "string" }, description: "Optional names for the sheets, in order." },
          image_column: { type: "string", description: "Optional: the column holding each row's picture." },
          folder: { type: "string", enum: ["store_data", "reports"], description: "Optional: where it belongs, when it is not plain store data." },
        },
        required: ["sources", "output"],
      },
      execute: async (args) => {
        try {
          const sources = Array.isArray(args.sources) ? args.sources.map(String).slice(0, MAX_SHEETS) : [];
          if (!sources.length) return failure("Give at least one table in sources.");
          const output = String(args.output ?? "");
          if (!/\.xlsx$/i.test(output)) return failure("output must end in .xlsx.");
          const target = await resolveConfined(root, output, { mustExist: false });
          const names = Array.isArray(args.sheet_names) ? args.sheet_names.map(String) : [];
          const imageColumn = typeof args.image_column === "string" ? args.image_column.trim() : "";

          const workbook = new ExcelJS.Workbook();
          const report: string[] = [];
          const problems = new Map<string, number>();
          let images = 0;
          const used = new Set<string>();

          for (const [i, source] of sources.entries()) {
            const table = await readTable(await resolveConfined(root, source, { mustExist: true }));
            const rows = table.rows.slice(0, MAX_ROWS);
            const wanted = (names[i] || path.basename(source).replace(/\.[^.]+$/, "")).replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Sheet ${i + 1}`;
            let name = wanted;
            for (let n = 2; used.has(name.toLowerCase()); n++) name = `${wanted.slice(0, 27)} (${n})`;
            used.add(name.toLowerCase());
            const rtl = hasArabic(table.columns.join(" ")) || rows.slice(0, 20).some((r) => r.some(hasArabic));
            const ws = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, rightToLeft: rtl }] });

            ws.addRow(table.columns).font = { bold: true };
            for (const r of rows) ws.addRow(r);
            ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, table.columns.length) } };
            table.columns.forEach((c, ci) => {
              const longest = Math.max(c.length, ...rows.slice(0, 200).map((r) => (r[ci] ?? "").length));
              ws.getColumn(ci + 1).width = Math.min(50, Math.max(10, longest + 2));
            });

            let placed = 0;
            const ci = imageColumn ? table.columns.findIndex((c) => c.trim().toLowerCase() === imageColumn.toLowerCase()) : -1;
            if (imageColumn && ci < 0) return failure(`${source} has no column named "${imageColumn}". Its columns: ${table.columns.join(", ")}.`);
            if (ci >= 0) {
              ws.getColumn(ci + 1).width = IMAGE_COL_CHARS;
              const jobs = rows.map((r, ri) => ({ ri, value: r[ci] ?? "" })).filter((j) => j.value.trim());
              for (let start = 0; start < jobs.length && images < MAX_IMAGES; start += DOWNLOADS_AT_ONCE) {
                const batch = jobs.slice(start, start + DOWNLOADS_AT_ONCE);
                const loaded = await Promise.all(batch.map((j) => loadImage(root, j.value)));
                batch.forEach((job, k) => {
                  const result = loaded[k]!;
                  if (typeof result === "string") {
                    problems.set(result, (problems.get(result) ?? 0) + 1);
                    return;
                  }
                  if (images >= MAX_IMAGES) return;
                  const id = workbook.addImage({ buffer: Buffer.from(result) as unknown as ExcelJS.Buffer, extension: imageFormat(result)! });
                  const rowNumber = job.ri + 2;
                  ws.getRow(rowNumber).height = IMAGE_ROW_POINTS;
                  ws.getCell(rowNumber, ci + 1).value = null;
                  ws.addImage(id, { tl: { col: ci + 0.1, row: rowNumber - 1 + 0.1 }, ext: { width: 72, height: 72 }, editAs: "oneCell" });
                  images += 1;
                  placed += 1;
                });
              }
            }
            report.push(`sheet "${name}": ${rows.length} rows${table.rows.length > MAX_ROWS ? ` (first ${MAX_ROWS})` : ""}${ci >= 0 ? `, ${placed} pictures` : ""}`);
          }

          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, new Uint8Array(await workbook.xlsx.writeBuffer()));
          const relative = path.relative(await fs.realpath(root), target).split(path.sep).join("/");
          // What the panel opens: the same sheets and pictures as an uploaded workbook.
          await convertWorkbook(await fs.realpath(root), relative, `file-views/${relative.replace(/\.[^./]+$/, "")}`);
          onWrite(relative, sources, typeof args.folder === "string" ? args.folder : undefined);
          const missed = [...problems].map(([why, n]) => `${n} ${why}`).join(", ");
          return text(`Wrote ${relative}: ${report.join("; ")}.${missed ? ` Pictures left out: ${missed}.` : ""}`);
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },
  };
}
