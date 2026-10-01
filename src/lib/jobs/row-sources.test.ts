import { describe, expect, it } from "vitest";
import type { ProjectRow } from "@/lib/storage-helpers";
import { buildRowSources, imageUrlsFromText, MAX_SOURCE_FIELD_CHARS, MAX_SOURCE_IMAGES } from "./row-sources";
import { buildEnrichPrompt } from "@/lib/enrich/prompt";
import { buildEnrichToolPolicy } from "@/lib/enrich/policy";

function row(originalData: Record<string, string>, enrichedData: Record<string, unknown> = {}): ProjectRow {
  return { id: "r1", rowIndex: 0, status: "pending", originalData, enrichedData };
}

describe("buildRowSources", () => {
  it("attaches Image Finder output as images, not URL text", () => {
    const { productData, sourceImageUrls } = buildRowSources(
      row(
        { Name: "Widget" },
        { imageUrls: [{ imageUrl: "https://cdn.example.com/a.jpg" }, { imageUrl: "https://cdn.example.com/b.jpg" }] }
      ),
      ["Name", "imageUrls"],
      new Set(["imageUrls"])
    );
    expect(sourceImageUrls).toEqual(["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]);
    expect(productData.imageUrls).toBe("[2 images attached]");
    expect(productData.Name).toBe("Widget");
  });

  it("finds AI columns from other tools even when they are not in the run's column list", () => {
    const { productData } = buildRowSources(
      row({ Name: "Widget" }, { categories: ["Tools", "Hand tools"] }),
      ["categories"],
      new Set()
    );
    expect(productData.categories).toBe("Tools\nHand tools");
  });

  it("treats image-named sheet columns as images, including CDN URLs without an extension", () => {
    const { sourceImageUrls, productData } = buildRowSources(
      row({ "Image Src": "https://cdn.shopify.com/s/files/1/0001/products/abc?v=123", Title: "T" }),
      ["Image Src", "Title"],
      new Set()
    );
    expect(sourceImageUrls).toEqual(["https://cdn.shopify.com/s/files/1/0001/products/abc?v=123"]);
    expect(productData["Image Src"]).toBe("[1 image attached]");
  });

  it("does not treat a plain link column as images", () => {
    expect(imageUrlsFromText("Product page", "https://shop.example.com/products/widget")).toEqual([]);
    expect(imageUrlsFromText("Product page", "https://shop.example.com/a.png, https://x.com/b.jpg")).toHaveLength(2);
  });

  it("splits comma / newline lists, dedupes and caps at the image limit", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    const { sourceImageUrls } = buildRowSources(
      row({ Images: [...urls, urls[0]].join(", ") }),
      ["Images"],
      new Set()
    );
    expect(sourceImageUrls).toHaveLength(MAX_SOURCE_IMAGES);
    expect(new Set(sourceImageUrls).size).toBe(MAX_SOURCE_IMAGES);
  });

  it("names AI source columns by their label and writes found pages with their titles", () => {
    const { productData } = buildRowSources(
      row(
        { Name: "Widget", "Title tag": "Old title" },
        {
          sourceUrls: [
            { title: "Widget WX-1 | Acme", uri: "https://acme.com/wx-1" },
            { title: "https://shop.example.com/wx-1", uri: "https://shop.example.com/wx-1" },
          ],
          titleTag: "New title",
          custom_1: [],
        }
      ),
      ["Name", "sourceUrls", "titleTag", "Title tag", "custom_1"],
      new Set(),
      { sourceUrls: "Source URLs", titleTag: "Title tag", custom_1: "Care tips" }
    );
    expect(productData["Source URLs"]).toBe("Widget WX-1 | Acme (https://acme.com/wx-1), https://shop.example.com/wx-1");
    // Never overwrites a sheet column that has the same name.
    expect(productData["Title tag"]).toBe("Old title");
    expect(productData["Title tag (AI)"]).toBe("New title");
    // An empty AI value sends nothing.
    expect(Object.keys(productData)).not.toContain("Care tips");
    expect(productData.sourceUrls).toBeUndefined();
  });

  it("keeps long descriptions up to the raised field cap", () => {
    const long = "x".repeat(MAX_SOURCE_FIELD_CHARS + 500);
    const { productData } = buildRowSources(row({ Description: long }), ["Description"], new Set());
    expect(productData.Description).toHaveLength(MAX_SOURCE_FIELD_CHARS);
  });
});

describe("buildEnrichPrompt layout", () => {
  const columns = [
    { id: "titleTag", label: "Title tag", description: "Title tag", type: "text" as const, enabled: true },
    {
      id: "custom_1",
      label: "Care tips",
      description: "Care tips",
      type: "text" as const,
      enabled: true,
      isCustom: true,
      customInstruction: "Write three care tips",
    },
  ];

  it("puts the stable agent + numbered columns in instructions and only row data in the input", () => {
    const policy = buildEnrichToolPolicy(["titleTag", "custom_1"], columns, "product");
    const prompt = buildEnrichPrompt({
      productData: { Name: "Widget" },
      enabledColumns: ["titleTag", "custom_1"],
      enrichmentColumns: columns,
      policy,
      sourceImageUrls: ["https://cdn.example.com/a.jpg"],
    });
    expect(prompt.instructions).toContain("Columns to fill (2):");
    expect(prompt.instructions).toContain("Write three care tips");
    expect(prompt.instructions).not.toContain("Widget");
    expect(prompt.text).toContain("Widget");
    expect(prompt.text).not.toContain("Columns to fill");
    expect(prompt.text).toContain("1 product image is attached");
    expect(prompt.imageUrls).toEqual(["https://cdn.example.com/a.jpg"]);
  });
});
