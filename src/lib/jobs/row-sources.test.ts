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

  it("attaches pictures saved from the sheet as images, whatever the column is called", () => {
    const { productData, sourceImageUrls } = buildRowSources(
      row({ Name: "Widget", Photo: "vz-storage:ws/catalog/images/a.png", Col9: "vz-storage:ws/b.jpg\nvz-storage:ws/c.jpg" }),
      ["Name", "Photo", "Col9"],
      new Set()
    );
    expect(sourceImageUrls).toEqual(["vz-storage:ws/catalog/images/a.png", "vz-storage:ws/b.jpg", "vz-storage:ws/c.jpg"]);
    expect(productData.Photo).toBe("[1 image attached]");
    expect(productData.Col9).toBe("[2 images attached]");
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

  it("collects the pages of Source URLs and Image sources columns, and can keep them out of the text fields", () => {
    const enriched = {
      sourceUrls: [
        { title: "Widget WX-1 | Acme", uri: "https://acme.com/wx-1" },
        { title: "https://shop.example.com/wx-1", uri: "https://shop.example.com/wx-1" },
        { title: "No link", uri: "" },
      ],
      imageSourceUrls: [
        { title: "shop.example.com", uri: "https://shop.example.com/wx-1" },
        { title: "other.test", uri: "https://other.test/wx-1" },
      ],
    };
    const source = row({ Name: "Widget" }, enriched);
    const labels = { sourceUrls: "Source URLs", imageSourceUrls: "Image sources" };

    const asText = buildRowSources(source, ["Name", "sourceUrls", "imageSourceUrls"], new Set(), labels);
    expect(asText.knownPages).toEqual([
      { url: "https://acme.com/wx-1", title: "Widget WX-1 | Acme" },
      { url: "https://shop.example.com/wx-1" },
      { url: "https://other.test/wx-1", title: "other.test" },
    ]);
    expect(asText.productData["Source URLs"]).toContain("https://acme.com/wx-1");

    const asLeads = buildRowSources(source, ["Name", "sourceUrls", "imageSourceUrls"], new Set(), labels, {
      pagesAsLeads: true,
    });
    expect(asLeads.knownPages).toEqual(asText.knownPages);
    expect(Object.keys(asLeads.productData)).toEqual(["Name"]);
  });

  it("has no known pages when no page column is ticked or its value is empty", () => {
    expect(buildRowSources(row({ Name: "Widget" }, { sourceUrls: [] }), ["Name", "sourceUrls"], new Set()).knownPages).toEqual([]);
    expect(buildRowSources(row({ Name: "Widget" }, { sourceUrls: [{ uri: "https://a.test/x" }] }), ["Name"], new Set()).knownPages).toEqual([]);
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

  it("offers a text for a call whose pictures could not load, with no image claimed", () => {
    const policy = buildEnrichToolPolicy(["titleTag"], columns, "product");
    const withImages = buildEnrichPrompt({
      productData: { Name: "Widget", "Image Src": "[2 images attached]", Photo: "data:image/png;base64,AAAA" },
      enabledColumns: ["titleTag"],
      enrichmentColumns: columns,
      policy,
      sourceImageUrls: ["https://cdn.example.com/a.jpg"],
    });
    expect(withImages.text).toContain("[2 images attached]");
    expect(withImages.text).toContain("2 product images are attached");

    const plain = withImages.textWithoutImages!;
    expect(plain).toContain("- Name: Widget");
    expect(plain).toContain("- Image Src: [image could not be loaded]");
    expect(plain).toContain("- Photo: [image could not be loaded]");
    expect(plain).toContain("no image is attached");
    expect(plain).not.toMatch(/\d+ product images? (is|are) attached|\[\d+ images? attached\]|\[attached image\]/);

    const noImages = buildEnrichPrompt({
      productData: { Name: "Widget" },
      enabledColumns: ["titleTag"],
      enrichmentColumns: columns,
      policy,
    });
    expect(noImages.textWithoutImages).toBeUndefined();
  });

  it("gives the agent the research method, with images and source pages as aids to find the product", () => {
    const policy = buildEnrichToolPolicy(["titleTag"], columns, "product");
    const prompt = buildEnrichPrompt({
      productData: { Name: "Widget" },
      enabledColumns: ["titleTag"],
      enrichmentColumns: columns,
      policy,
      sourceImageUrls: ["https://cdn.example.com/a.jpg"],
    });
    expect(prompt.instructions).toContain("Scan the row for identifiers");
    expect(prompt.instructions).toContain("Variants (colour, size, pack) of the same product are the same product");
    expect(prompt.instructions).toContain("help you find the product quickly");
    expect(prompt.instructions).toContain("Source URLs or Image sources");
    expect(prompt.instructions).toContain("Never guess and never use similar products");
    expect(prompt.instructions).toContain("Wording is yours");
    expect(prompt.text).toContain("help your web research find the exact item");
  });

  it("adds the instruction for all columns before the columns, and nothing when it is empty", () => {
    const policy = buildEnrichToolPolicy(["titleTag"], columns, "product");
    const base = { productData: { Name: "Widget" }, enabledColumns: ["titleTag"], enrichmentColumns: columns, policy };
    const withGlobal = buildEnrichPrompt({
      ...base,
      settings: { enrichmentModel: "standard", outputLanguage: "English", globalInstruction: "Scan the barcode first." },
    });
    const text = withGlobal.instructions;
    expect(text).toContain("Owner's instruction for all columns");
    expect(text).toContain("Scan the barcode first.");
    expect(text.indexOf("Scan the barcode first.")).toBeLessThan(text.indexOf("Columns to fill"));
    expect(text).toContain("A column's own custom instruction wins if the two conflict");

    const without = buildEnrichPrompt({
      ...base,
      settings: { enrichmentModel: "standard", outputLanguage: "English", globalInstruction: "   " },
    });
    expect(without.instructions).not.toContain("Owner's instruction for all columns");
  });

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
