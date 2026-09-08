import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { buildGalleryExportBuffer } from "@/lib/gallery/export-builder";
import { collectGalleryImagePaths } from "@/lib/gallery/signed-urls";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";

function worksheet(): GalleryWorksheetJson {
  return {
    sessionId: "session",
    columns: ["SKU"],
    originalImageColumn: null,
    originalImageSelectionExplicit: true,
    selectedColumns: ["SKU"],
    settings: {
      provider: "scraping",
      scraping: DEFAULT_SCRAPING_SETTINGS,
      ai: {
        ...DEFAULT_AI_SETTINGS,
        logoPath: "workspace/logo.png",
      },
    },
    activeRun: null,
    rows: [
      {
        id: "row",
        rowIndex: 0,
        status: "ready",
        originalData: { SKU: "123" },
        mainImagePath: "workspace/main.webp",
        galleryImagePaths: [
          "https://cdn.example/side.jpg",
          "workspace/gallery.webp",
        ],
      },
    ],
  };
}

describe("external gallery URLs", () => {
  it("never sends external URLs to Supabase signing", () => {
    expect(collectGalleryImagePaths(worksheet())).toEqual([
      "workspace/logo.png",
      "workspace/main.webp",
      "workspace/gallery.webp",
    ]);
  });

  it("can sign a subset of rows without walking the whole sheet", () => {
    const sheet = worksheet();
    sheet.rows.push({
      id: "other",
      rowIndex: 1,
      status: "ready",
      originalData: { SKU: "456" },
      mainImagePath: "workspace/other.webp",
      galleryImagePaths: ["workspace/other-gal.webp"],
    });
    expect(collectGalleryImagePaths(sheet, ["row"])).toEqual([
      "workspace/logo.png",
      "workspace/main.webp",
      "workspace/gallery.webp",
    ]);
  });

  it("exports external URLs unchanged and signs storage paths only", async () => {
    const sign = vi.fn(async (path: string) => `https://signed.example/${path}`);
    const buffer = await buildGalleryExportBuffer(worksheet(), sign);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const row = workbook.getWorksheet("Gallery")!.getRow(2);

    expect(row.getCell(1).value).toBe(
      "https://signed.example/workspace/main.webp"
    );
    expect(row.getCell(2).value).toBe(
      "https://cdn.example/side.jpg,\nhttps://signed.example/workspace/gallery.webp"
    );
    expect(sign).toHaveBeenCalledTimes(2);
    expect(sign).not.toHaveBeenCalledWith("https://cdn.example/side.jpg");
  });
});
