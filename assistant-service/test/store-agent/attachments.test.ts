import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../../src/lib/store-agent/csv";
import { convertAttachment } from "../../src/store-agent/attachments";
import { createExcelTool, imageFormat, isPublicAddress, publicImageUrl } from "../../src/store-agent/excel-tool";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function folder() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sa-attach-"));
  await mkdir(path.join(root, "attachments"), { recursive: true });
  return root;
}

/** A one-page PDF that says `text`, with a correct cross-reference table. */
function pdfSaying(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 18 Tf 20 100 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 20 100 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

describe("attachments the agent cannot read as they are", () => {
  it("turns each Excel sheet into a CSV, with the pictures on their rows", async () => {
    const root = await folder();
    const wb = new ExcelJS.Workbook();
    const products = wb.addWorksheet("Products");
    products.addRow(["Title", "Price", "Photo"]);
    products.addRow(["ساعة ذكية", 199, null]);
    products.addRow(["Earbuds, Pro", { formula: "100+29", result: 129 }, null]);
    const image = wb.addImage({ buffer: PNG as unknown as ExcelJS.Buffer, extension: "png" });
    products.addImage(image, { tl: { col: 2, row: 1 }, ext: { width: 20, height: 20 } });
    wb.addWorksheet("Notes").addRow(["note"]).commit();
    wb.getWorksheet("Notes")!.addRow(["hello"]);
    await wb.xlsx.writeFile(path.join(root, "attachments", "kaystore_export.xlsx"));

    const result = await convertAttachment(root, "attachments/kaystore_export.xlsx");
    expect(result?.made).toEqual(
      expect.arrayContaining(["attachments/kaystore_export - Products.csv", "attachments/kaystore_export - Notes.csv"])
    );
    const rows = parseCsv(await readFile(path.join(root, "attachments", "kaystore_export - Products.csv"), "utf8"));
    expect(rows[0]).toEqual(["image", "Title", "Price", "Photo"]);
    expect(rows[1]!.slice(1, 3)).toEqual(["ساعة ذكية", "199"]);
    expect(rows[2]!.slice(1, 3)).toEqual(["Earbuds, Pro", "129"]);
    const picture = rows[1]![0]!;
    expect(picture).toMatch(/^attachments\/kaystore_export-images\/.+\.png$/);
    expect(await readFile(path.join(root, ...picture.split("/")))).toEqual(PNG);
    expect(rows[2]![0]).toBe("");
    expect(result?.note).toContain("kaystore_export - Products.csv");
  });

  it("names a single sheet's CSV after the workbook", async () => {
    const root = await folder();
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1").addRow(["sku", "title"]);
    wb.getWorksheet("Sheet1")!.addRow(["A1", "Bag"]);
    await wb.xlsx.writeFile(path.join(root, "attachments", "list.xlsx"));
    expect((await convertAttachment(root, "attachments/list.xlsx"))?.made).toEqual(["attachments/list.csv"]);
  });

  it("turns a PDF into its text, and says when an old .xls cannot be read", async () => {
    const root = await folder();
    await writeFile(path.join(root, "attachments", "specs.pdf"), pdfSaying("Battery 5000 mAh"));
    const pdf = await convertAttachment(root, "attachments/specs.pdf");
    expect(pdf?.made).toEqual(["attachments/specs.txt"]);
    expect(await readFile(path.join(root, "attachments", "specs.txt"), "utf8")).toContain("Battery 5000 mAh");

    await writeFile(path.join(root, "attachments", "old.xls"), "x");
    expect((await convertAttachment(root, "attachments/old.xls"))?.note).toMatch(/\.xlsx or \.csv/);
    expect(await convertAttachment(root, "attachments/list.csv")).toBeNull();
  });
});

describe("make_excel", () => {
  const call = async (tools: ReturnType<typeof createExcelTool>, args: Record<string, unknown>) =>
    (await tools.make_excel!.execute(args as never, { sessionId: "s" } as never)) as { content: Array<{ text: string }>; isError?: boolean };

  it("writes a workbook with each row's picture, right to left for Arabic", async () => {
    const root = await folder();
    await mkdir(path.join(root, "images"));
    await writeFile(path.join(root, "images", "a.png"), PNG);
    await writeFile(
      path.join(root, "products.csv"),
      "title,price,image\nساعة,199,images/a.png\nحقيبة,50,https://evil.example/x.png\nقلم,5,\n"
    );
    const written: string[] = [];
    const tools = createExcelTool(root, (r) => written.push(r));
    const res = await call(tools, { sources: ["products.csv"], output: "reports/products.xlsx", image_column: "image" });
    expect(res.isError).toBeUndefined();
    expect(written).toEqual(["reports/products.xlsx"]);
    expect(res.content[0]!.text).toContain("1 pictures");
    expect(res.content[0]!.text).toContain("1 not a public https link");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(root, "reports", "products.xlsx"));
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(2).getCell(1).value).toBe("ساعة");
    expect(ws.getImages()).toHaveLength(1);
    expect(ws.views[0]?.rightToLeft).toBe(true);
  });

  it("refuses outputs that are not .xlsx and unknown columns", async () => {
    const root = await folder();
    await writeFile(path.join(root, "t.csv"), "a,b\n1,2\n");
    const tools = createExcelTool(root, () => undefined);
    expect((await call(tools, { sources: ["t.csv"], output: "t.csv" })).isError).toBe(true);
    expect((await call(tools, { sources: ["t.csv"], output: "t.xlsx", image_column: "photo" })).content[0]!.text).toContain("no column");
    expect((await call(tools, { sources: ["../t.csv"], output: "t.xlsx" })).isError).toBe(true);
  });

  it("never fetches pictures from the service's own network", async () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    expect(isPublicAddress("151.101.1.1")).toBe(true);
    expect(await publicImageUrl("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(await publicImageUrl("https://[::1]/x.png")).toBeNull();
    expect(await publicImageUrl("https://localhost/x.png")).toBeNull();
    expect(await publicImageUrl("http://151.101.1.1/x.png")).toBeNull();
    expect(await publicImageUrl("https://user:pw@151.101.1.1/x.png")).toBeNull();
    expect(await publicImageUrl("https://151.101.1.1/x.png")).not.toBeNull();
    expect(imageFormat(PNG)).toBe("png");
    expect(imageFormat(Buffer.from("RIFF0000WEBP"))).toBeNull();
  });
});
