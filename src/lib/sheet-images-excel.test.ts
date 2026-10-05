import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseExcelFile } from "./excel";
import { attachSheetImages, extractSheetImages } from "./sheet-images";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function workbookWithPictures(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Items");
  sheet.addRow(["Name", "Brand", "PIC"]);
  sheet.addRow(["Shirt", "Acme", ""]);
  sheet.addRow(["", "", ""]);
  sheet.addRow(["Pants", "Acme", ""]);
  const imageId = workbook.addImage({ base64: PNG_1PX, extension: "png" });
  sheet.addImage(imageId, { tl: { col: 2, row: 1 }, ext: { width: 40, height: 40 } });
  sheet.addImage(imageId, { tl: { col: 2, row: 3 }, ext: { width: 40, height: 40 } });
  const out = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(out as ArrayBuffer);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("sheet pictures end to end", () => {
  it("maps each picture to its parsed row, skipping the blank row between", async () => {
    const buffer = await workbookWithPictures();
    const parsed = await parseExcelFile(buffer);
    expect(parsed.rowSheetIndexes).toEqual([1, 3]);
    expect(parsed.headers.slice(0, 3)).toEqual(["Name", "Brand", "PIC"]);

    const images = await extractSheetImages(buffer);
    expect(images).toHaveLength(2);

    const uploaded: string[] = [];
    const attached = await attachSheetImages({
      images,
      parsed,
      upload: async (image) => {
        uploaded.push(image.key);
        return `ws/catalog/images/${uploaded.length}.${image.ext}`;
      },
    });

    expect(uploaded).toHaveLength(1);
    expect(attached.imageCount).toBe(2);
    expect(attached.rows.map((row) => [row.Name, row.PIC])).toEqual([
      ["Shirt", "vz-storage:ws/catalog/images/1.png"],
      ["Pants", "vz-storage:ws/catalog/images/1.png"],
    ]);
  });
});
