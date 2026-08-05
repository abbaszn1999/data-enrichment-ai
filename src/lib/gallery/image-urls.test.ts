import { describe, expect, it } from "vitest";
import {
  cellContainsHttpUrl,
  cellIsPrimarilyHttpUrl,
  listColumnsWithHttpUrls,
} from "@/lib/gallery/image-urls";

describe("listColumnsWithHttpUrls", () => {
  it("keeps only columns whose cells are mostly http URLs", () => {
    const rows = [
      {
        originalData: {
          SKU: "A-1",
          Name: "Phone",
          Image: "https://cdn.example/a.jpg",
          Page: "https://shop.example/a",
          Notes: "see https://docs.example/help for details",
        },
      },
      {
        originalData: {
          SKU: "A-2",
          Name: "Tablet",
          Image: "https://cdn.example/b.jpg",
          Page: "https://shop.example/b",
          Notes: "plain text note",
        },
      },
      {
        originalData: {
          SKU: "A-3",
          Name: "Watch",
          Image: "https://cdn.example/c.jpg",
          Page: "",
          Notes: "another note",
        },
      },
    ];

    expect(
      listColumnsWithHttpUrls({
        columns: ["SKU", "Name", "Image", "Page", "Notes"],
        rows,
        minUrlShare: 0.25,
      })
    ).toEqual(["Image", "Page"]);
  });

  it("returns empty when no URL-like columns exist", () => {
    expect(
      listColumnsWithHttpUrls({
        columns: ["SKU", "Name"],
        rows: [{ originalData: { SKU: "1", Name: "Item" } }],
      })
    ).toEqual([]);
  });

  it("detects primary URL cells vs prose that mentions a link", () => {
    expect(cellContainsHttpUrl("https://cdn.example/x.webp")).toBe(true);
    expect(cellIsPrimarilyHttpUrl("https://cdn.example/x.webp")).toBe(true);
    expect(
      cellIsPrimarilyHttpUrl("see https://docs.example/help for details")
    ).toBe(false);
    expect(cellContainsHttpUrl("SKU-123")).toBe(false);
    expect(cellContainsHttpUrl("")).toBe(false);
  });
});
