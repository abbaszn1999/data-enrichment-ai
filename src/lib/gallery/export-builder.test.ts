import { describe, expect, it } from "vitest";
import {
  buildGalleryExportHeaders,
  buildGalleryExportTable,
  galleryImageSources,
} from "@/lib/gallery/export-builder";
import { createEmptyWorksheet, type GalleryWorksheetJson } from "@/lib/gallery/types";

function sheet(columns = ["Name", "Image"]): GalleryWorksheetJson {
  const worksheet = createEmptyWorksheet("s1", columns, [
    { id: "r1", rowIndex: 0, originalData: { Name: "Lamp", Image: "https://cdn.x/a.jpg" } },
  ]);
  worksheet.originalImageColumn = "Image";
  worksheet.rows[0].galleryImagePaths = [
    "https://cdn.x/g1.jpg",
    "https://cdn.x/g2.jpg",
  ];
  worksheet.rows[0].sourceMeta = {
    images: [
      {
        ref: "https://cdn.x/g1.jpg",
        role: "gallery",
        persistence: "external",
        pageUrl: "https://shop.x/lamp",
      },
      {
        ref: "https://cdn.x/g2.jpg",
        role: "gallery",
        persistence: "external",
        pageUrl: "https://brand.x/lamp",
      },
    ],
  };
  return worksheet;
}

describe("gallery export", () => {
  it("adds a Gallery Sources column after Gallery Images", () => {
    expect(buildGalleryExportHeaders(sheet())).toEqual([
      "Gallery Images",
      "Gallery Sources",
      "Name",
      "Image",
    ]);
  });

  it("does not duplicate a Gallery Sources column the sheet already has", () => {
    const headers = buildGalleryExportHeaders(sheet(["Name", "Image", "Gallery Sources"]));
    expect(headers.filter((header) => header === "Gallery Sources")).toHaveLength(1);
  });

  it("lists one page per image in the same order", async () => {
    const table = await buildGalleryExportTable(sheet(), async (path) => path);
    expect(table.rows[0][0]).toBe("https://cdn.x/g1.jpg,\nhttps://cdn.x/g2.jpg");
    expect(table.rows[0][1]).toBe("https://shop.x/lamp,\nhttps://brand.x/lamp");
  });

  it("leaves the cell blank when no provenance is known", () => {
    const worksheet = sheet();
    worksheet.rows[0].sourceMeta = {};
    expect(galleryImageSources(worksheet.rows[0])).toEqual(["", ""]);
  });
});
