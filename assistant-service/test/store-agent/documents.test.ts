import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { convertAttachment } from "../../src/store-agent/attachments";
import { createDocumentTool } from "../../src/store-agent/document-tool";
import { assertSafeZip, makePdf, makeWord, markdownBlocks, readPowerPoint, readWord, visualRuns } from "../../src/store-agent/documents";
import { createExcelTool } from "../../src/store-agent/excel-tool";

const REPORT = `# تقرير الأسعار

مقدمة **مهمة** عن PulseWatch Series 7 بسعر 199 دولار.

- البند الأول
- Second item

1. خطوة

| المنتج | السعر |
| --- | --- |
| ساعة | 199 |
`;

async function folder() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sa-docs-"));
  await mkdir(path.join(root, "attachments"), { recursive: true });
  return root;
}
type Result = { content: Array<{ text: string }>; isError?: boolean };

describe("documents", () => {
  it("reads the Markdown a report needs", () => {
    expect(markdownBlocks(REPORT).map((b) => b.kind)).toEqual(["heading", "paragraph", "bullet", "bullet", "number", "table"]);
    const table = markdownBlocks(REPORT).at(-1);
    expect(table).toEqual({ kind: "table", rows: [["المنتج", "السعر"], ["ساعة", "199"]] });
  });

  it("makes a Word file that reads back, with its Arabic intact", async () => {
    const { html, text } = await readWord(await makeWord(REPORT));
    expect(text).toContain("تقرير الأسعار");
    expect(text).toContain("PulseWatch Series 7");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("<table");
  });

  it("makes a PDF with every line's text, and orders mixed text right to left", async () => {
    const bytes = await makePdf(REPORT);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const { totalPages } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
    expect(totalPages).toBe(1);

    const { runs, rtl } = visualRuns("سعر PulseWatch اليوم");
    expect(rtl).toBe(true);
    // Read from the left: the last Arabic words, then the Latin name, then the first ones.
    expect(runs.map((r) => r.text.trim())).toEqual(["اليوم", "PulseWatch", "سعر"]);
    expect(visualRuns("Plain English").rtl).toBe(false);
  });

  it("reads a PowerPoint slide by slide", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>الشريحة الثانية</a:t></a:r></a:p></p:sld>");
    zip.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Sales &amp; </a:t></a:r><a:r><a:t>growth</a:t></a:r></a:p></p:sld>");
    const { text, slides } = await readPowerPoint(await zip.generateAsync({ type: "nodebuffer" }));
    expect(slides).toBe(2);
    expect(text).toBe("--- Slide 1 ---\nSales & growth\n\n--- Slide 2 ---\nالشريحة الثانية");
  });

  it("refuses a zip that unpacks to far too much, without unpacking it", async () => {
    const zip = new JSZip();
    zip.file("big.txt", Buffer.alloc(201 * 1024 * 1024));
    const bomb = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await expect(assertSafeZip(bomb)).rejects.toThrow(/too much/);
    const root = await folder();
    await writeFile(path.join(root, "attachments", "bomb.docx"), bomb);
    expect((await convertAttachment(root, "attachments/bomb.docx"))?.note).toMatch(/could not be opened/);
  }, 60_000);

  it("converts Word, PowerPoint, old Office and media attachments", async () => {
    const root = await folder();
    await writeFile(path.join(root, "attachments", "contract.docx"), await makeWord(REPORT));
    const word = await convertAttachment(root, "attachments/contract.docx");
    expect(word?.made).toEqual(["attachments/contract.html", "attachments/contract.txt"]);
    expect(await readFile(path.join(root, "attachments", "contract.txt"), "utf8")).toContain("تقرير الأسعار");

    await writeFile(path.join(root, "attachments", "old.doc"), "x");
    expect((await convertAttachment(root, "attachments/old.doc"))?.note).toMatch(/\.docx or \.pptx/);
    await writeFile(path.join(root, "attachments", "clip.mp4"), "x");
    expect((await convertAttachment(root, "attachments/clip.mp4"))?.note).toMatch(/cannot hear or watch/);
  });

  it("make_document writes Word and PDF, and only those", async () => {
    const root = await folder();
    const written: Array<[string, string | undefined]> = [];
    const tools = createDocumentTool(root, (r, f) => written.push([r, f]));
    const call = async (args: Record<string, unknown>) => (await tools.make_document!.execute(args as never, { sessionId: "s" } as never)) as Result;

    expect((await call({ output: "reports/a.pdf", content: REPORT })).isError).toBeUndefined();
    expect((await readFile(path.join(root, "reports", "a.pdf"))).subarray(0, 4).toString()).toBe("%PDF");
    expect((await call({ output: "reports/b.docx", content: REPORT, folder: "reports" })).isError).toBeUndefined();
    // What the panel opens for it.
    expect(await readFile(path.join(root, "file-views", "reports", "b.html"), "utf8")).toContain("<table");
    expect(written).toEqual([["reports/a.pdf", undefined], ["reports/b.docx", "reports"]]);

    expect((await call({ output: "a.txt", content: "x" })).isError).toBe(true);
    expect((await call({ output: "a.pdf" })).isError).toBe(true);
    expect((await call({ output: "../a.pdf", content: "x" })).isError).toBe(true);
  });

  it("make_excel leaves sheets for the panel, and says what it was made from", async () => {
    const root = await folder();
    await mkdir(path.join(root, "exports"));
    await writeFile(path.join(root, "exports", "p.csv"), "title,price\nBag,5\n");
    const calls: unknown[][] = [];
    const tools = createExcelTool(root, (...a) => calls.push(a));
    const res = (await tools.make_excel!.execute({ sources: ["exports/p.csv"], output: "reports/p.xlsx", folder: "reports" } as never, { sessionId: "s" } as never)) as Result;
    expect(res.isError).toBeUndefined();
    expect(calls).toEqual([["reports/p.xlsx", ["exports/p.csv"], "reports"]]);
    expect(await readFile(path.join(root, "file-views", "reports", "p.csv"), "utf8")).toContain("Bag,5");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(root, "reports", "p.xlsx"));
    expect(wb.worksheets[0]!.getRow(2).getCell(1).value).toBe("Bag");
  });
});
