import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { attachmentPath, cellImages, isExtractedImage, isTextFile, isWorkbook, looksLikeImage } from "./file-kinds";

describe("chat file kinds", () => {
  it("reads a .csv as text even when the browser called it Excel", () => {
    expect(isTextFile("list.csv", "application/vnd.ms-excel")).toBe(true);
    expect(isTextFile("report", "text/markdown")).toBe(true);
    expect(isTextFile("export.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(false);
    expect(isWorkbook("export.xlsx")).toBe(true);
  });

  it("finds pictures in table cells, one or several", () => {
    expect(looksLikeImage("https://kaystore.com/wp-content/uploads/2026/02/I138954.jpg")).toBe(true);
    expect(looksLikeImage("https://cdn.shopify.com/s/files/1/0/files/x?v=1")).toBe(true);
    expect(looksLikeImage("attachments/export-images/3.png")).toBe(true);
    expect(looksLikeImage("https://kaystore.com/product/duvet-cover/")).toBe(false);
    expect(looksLikeImage("../secret.png")).toBe(false);
    expect(cellImages("https://a.example/1.jpg\nhttps://a.example/2.jpg")).toEqual(["https://a.example/1.jpg", "https://a.example/2.jpg"]);
    expect(cellImages("a.png, b.png | c.png")).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("knows where an attachment and its pictures sit in the agent's folder", () => {
    expect(attachmentPath("kaystore export (1).xlsx")).toBe("attachments/kaystore export (1).xlsx");
    expect(attachmentPath("a/b:c.csv")).toBe("attachments/a_b_c.csv");
    expect(isExtractedImage("attachments/kaystore_export-images/0.jpg")).toBe(true);
    expect(isExtractedImage("attachments/kaystore_export.csv")).toBe(false);
  });

  it("parses CSV with a byte-order mark, quotes and line breaks in cells", () => {
    expect(parseCsv('﻿name,images\n"Bag, red","a.jpg\nb.jpg"\n')).toEqual([
      ["name", "images"],
      ["Bag, red", "a.jpg\nb.jpg"],
    ]);
  });
});
