import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import bidiFactory from "bidi-js";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import JSZip from "jszip";
import mammoth from "mammoth";
import PDFDocument from "pdfkit";

/**
 * Word, PowerPoint and PDF work for the Store Agent: reading what the user
 * attaches, and making Word and PDF files from Markdown.
 */

/** Most an Office file (a zip) may unpack to before it is refused. */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const MAX_SLIDES = 500;

/** Refuse a zip that would unpack to far more than any real document. Nothing is unpacked to check. */
export async function assertSafeZip(bytes: Uint8Array): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  let total = 0;
  zip.forEach((_, entry) => {
    total += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (total > MAX_UNPACKED_BYTES) throw new Error("The file unpacks to too much data.");
}

/** A Word file as a page to show and as plain text to read. */
export async function readWord(bytes: Buffer): Promise<{ html: string; text: string }> {
  await assertSafeZip(bytes);
  const [{ value: body }, { value: text }] = await Promise.all([mammoth.convertToHtml({ buffer: bytes }), mammoth.extractRawText({ buffer: bytes })]);
  const dir = /[؀-ۿ]/.test(text.slice(0, 500)) ? "rtl" : "ltr";
  const html =
    `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><style>` +
    "body{font-family:system-ui,sans-serif;line-height:1.6;max-width:800px;margin:24px auto;padding:0 24px;color:#111;background:#fff}" +
    "table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px}img{max-width:100%}" +
    `</style></head><body>${body}</body></html>`;
  return { html, text };
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const xmlText = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e]!);

/** A PowerPoint file's text, slide by slide. */
export async function readPowerPoint(bytes: Buffer): Promise<{ text: string; slides: number }> {
  await assertSafeZip(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const parts: string[] = [];
  for (const [i, name] of names.slice(0, MAX_SLIDES).entries()) {
    const xml = await zip.files[name]!.async("string");
    const paragraphs = [...xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)]
      .map((p) => [...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => xmlText(t[1]!)).join(""))
      .filter((line) => line.trim());
    parts.push(`--- Slide ${i + 1} ---\n${paragraphs.join("\n")}`);
  }
  return { text: parts.join("\n\n"), slides: names.length };
}

// ─── Markdown to blocks ──────────────────────────────────────────────────────

export type DocBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "number"; text: string; n: number }
  | { kind: "table"; rows: string[][] };

const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** The Markdown a report needs: headings, lists, tables and paragraphs. */
export function markdownBlocks(markdown: string): DocBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: DocBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const number = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      blocks.push({ kind: "heading", level: Math.min(heading[1]!.length, 3) as 1 | 2 | 3, text: heading[2]!.trim() });
    } else if (bullet) {
      flush();
      blocks.push({ kind: "bullet", text: bullet[1]!.trim() });
    } else if (number) {
      flush();
      blocks.push({ kind: "number", n: Number(number[1]), text: number[2]!.trim() });
    } else if (line.includes("|") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("-")) {
      flush();
      const rows = [tableCells(line)];
      i += 2;
      for (; i < lines.length && lines[i]!.includes("|") && lines[i]!.trim(); i++) rows.push(tableCells(lines[i]!));
      i--;
      blocks.push({ kind: "table", rows });
    } else paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
/** Inline Markdown as bold and plain pieces. */
function inline(text: string): Array<{ text: string; bold: boolean }> {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => (part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part.replace(/[`*_]/g, ""), bold: false }));
}
const plain = (text: string) => inline(text).map((p) => p.text).join("");

// ─── Word ────────────────────────────────────────────────────────────────────

const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;

function wordParagraph(text: string, options: { heading?: 1 | 2 | 3; bullet?: boolean; prefix?: string } = {}): Paragraph {
  const rtl = hasArabic(text);
  return new Paragraph({
    bidirectional: rtl,
    alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { after: 120 },
    ...(options.heading ? { heading: HEADINGS[options.heading] } : {}),
    ...(options.bullet ? { bullet: { level: 0 } } : {}),
    children: [
      ...(options.prefix ? [new TextRun({ text: options.prefix, rightToLeft: rtl })] : []),
      ...inline(text).map((p) => new TextRun({ text: p.text, bold: p.bold, rightToLeft: rtl })),
    ],
  });
}

export async function makeWord(markdown: string): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];
  for (const block of markdownBlocks(markdown)) {
    if (block.kind === "heading") children.push(wordParagraph(block.text, { heading: block.level }));
    else if (block.kind === "paragraph") children.push(wordParagraph(block.text));
    else if (block.kind === "bullet") children.push(wordParagraph(block.text, { bullet: true }));
    else if (block.kind === "number") children.push(wordParagraph(block.text, { prefix: `${block.n}. ` }));
    else {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          visuallyRightToLeft: block.rows.some((r) => r.some(hasArabic)),
          rows: block.rows.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [wordParagraph(cell)] })) })),
        })
      );
      children.push(new Paragraph({}));
    }
  }
  return Packer.toBuffer(new Document({ sections: [{ children: children.length ? children : [new Paragraph({})] }] }));
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const FONT_REGULAR = require.resolve("@expo-google-fonts/cairo/400Regular/Cairo_400Regular.ttf");
const FONT_BOLD = require.resolve("@expo-google-fonts/cairo/700Bold/Cairo_700Bold.ttf");
const bidi = bidiFactory();

type Run = { text: string; level: number };

/** A line of mixed Arabic and Latin as runs in the order they are drawn, left to right. */
export function visualRuns(line: string): { runs: Run[]; rtl: boolean } {
  const { levels, paragraphs } = bidi.getEmbeddingLevels(line);
  const base = paragraphs[0]?.level ?? 0;
  const runs: Run[] = [];
  const chars = [...line];
  let index = 0;
  for (const ch of chars) {
    const level = levels[index]!;
    index += ch.length;
    const last = runs[runs.length - 1];
    if (last && last.level === level) last.text += ch;
    else runs.push({ text: ch, level });
  }
  // Reverse each stretch of runs at or above each level, highest first (the Unicode rule).
  const top = Math.max(0, ...runs.map((r) => r.level));
  for (let level = top; level >= 1; level--) {
    for (let i = 0; i < runs.length; i++) {
      if (runs[i]!.level < level) continue;
      let j = i;
      while (j + 1 < runs.length && runs[j + 1]!.level >= level) j++;
      runs.splice(i, j - i + 1, ...runs.slice(i, j + 1).reverse());
      i = j;
    }
  }
  return { runs, rtl: base % 2 === 1 };
}

export function makePdf(markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("regular", FONT_REGULAR);
    doc.registerFont("bold", FONT_BOLD);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    const wrap = (text: string, size: number, font: string, max: number): string[] => {
      doc.font(font).fontSize(size);
      const lines: string[] = [];
      let current = "";
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const next = current ? `${current} ${word}` : word;
        if (doc.widthOfString(next) > max && current) {
          lines.push(current);
          current = word;
        } else current = next;
      }
      if (current) lines.push(current);
      return lines;
    };

    /** One line drawn run by run, aligned to the side its language starts from. */
    const drawLine = (line: string, x: number, y: number, max: number, size: number, font: string) => {
      doc.font(font).fontSize(size);
      const { runs, rtl } = visualRuns(line);
      // Word by word in drawing order: spaces drawn inside an Arabic run can get lost.
      const tokens = runs.flatMap((run) => {
        const parts = run.text.split(/(\s+)/).filter(Boolean);
        return run.level % 2 === 1 ? parts.reverse() : parts;
      });
      const spaceWidth = doc.widthOfString(" ");
      const widthOf = (token: string) => (token.trim() ? doc.widthOfString(token) : spaceWidth * token.length);
      const total = tokens.reduce((sum, token) => sum + widthOf(token), 0);
      let cursor = rtl ? x + max - total : x;
      for (const token of tokens) {
        if (token.trim()) doc.text(token, cursor, y, { lineBreak: false });
        cursor += widthOf(token);
      }
    };

    const paragraph = (text: string, opts: { size?: number; font?: string; after?: number; marker?: string } = {}) => {
      const size = opts.size ?? 11;
      const font = opts.font ?? "regular";
      const lineHeight = size * 1.7;
      const indent = opts.marker ? 16 : 0;
      const rtl = visualRuns(plain(text)).rtl;
      const lines = wrap(plain(text), size, font, width - indent);
      for (const [i, line] of lines.entries()) {
        if (doc.y + lineHeight > bottom()) doc.addPage();
        const y = doc.y;
        if (opts.marker && i === 0) {
          doc.font(font).fontSize(size);
          doc.text(opts.marker, rtl ? left + width - doc.widthOfString(opts.marker) : left, y, { lineBreak: false });
        }
        drawLine(line, rtl ? left : left + indent, y, width - indent, size, font);
        doc.y = y + lineHeight;
      }
      doc.y += opts.after ?? 6;
    };

    const table = (rows: string[][]) => {
      const columns = Math.max(...rows.map((r) => r.length));
      const cellWidth = width / columns;
      const rtl = rows.some((r) => r.some(hasArabic));
      const size = 9.5;
      const lineHeight = size * 1.6;
      rows.forEach((row, ri) => {
        const font = ri === 0 ? "bold" : "regular";
        const cells = Array.from({ length: columns }, (_, c) => wrap(plain(row[c] ?? ""), size, font, cellWidth - 10));
        const height = Math.max(1, ...cells.map((c) => c.length)) * lineHeight + 8;
        if (doc.y + height > bottom()) doc.addPage();
        const y = doc.y;
        cells.forEach((lines, c) => {
          const x = rtl ? left + width - (c + 1) * cellWidth : left + c * cellWidth;
          doc.lineWidth(0.5).strokeColor("#bbbbbb").rect(x, y, cellWidth, height).stroke();
          lines.forEach((line, l) => drawLine(line, x + 5, y + 4 + l * lineHeight, cellWidth - 10, size, font));
        });
        doc.y = y + height;
      });
      doc.y += 10;
    };

    doc.fillColor("#111111");
    for (const block of markdownBlocks(markdown)) {
      if (block.kind === "heading") paragraph(block.text, { size: block.level === 1 ? 20 : block.level === 2 ? 15 : 12.5, font: "bold", after: 8 });
      else if (block.kind === "paragraph") paragraph(block.text);
      else if (block.kind === "bullet") paragraph(block.text, { marker: "•", after: 3 });
      else if (block.kind === "number") paragraph(block.text, { marker: `${block.n}.`, after: 3 });
      else table(block.rows);
    }
    doc.end();
  });
}

/** Write a file, creating its folder. */
export async function writeInFolder(cwd: string, relative: string, body: string | Uint8Array): Promise<void> {
  const local = path.join(cwd, ...relative.split("/"));
  await fs.mkdir(path.dirname(local), { recursive: true });
  await fs.writeFile(local, body);
}
