import { describe, expect, it } from "vitest";
import {
  buildGalleryBrief,
  classifyRowValues,
  isImageFileUrl,
  textOnlyRow,
} from "./gallery-brief";

const settings = {
  instructions: "",
  sourcePolicy: "any" as const,
  minResolution: 1200,
  aspectRatio: "any",
  searchDepth: "high" as const,
};

describe("isImageFileUrl", () => {
  it("accepts image files and rejects pages and ambiguous CDN paths", () => {
    expect(isImageFileUrl("https://cdn.shop.com/files/a.jpg?v=12")).toBe(true);
    expect(isImageFileUrl("https://shop.com/products/blue-shirt")).toBe(false);
    expect(isImageFileUrl("https://shop.com/media/product-12")).toBe(false);
    expect(isImageFileUrl("not a url")).toBe(false);
  });
});

describe("classifyRowValues", () => {
  const row = {
    Title: "Acme Trail Shoe <b>Blue</b>",
    SKU: "AC-12345",
    "Image URLs": "https://cdn.shop.com/a.jpg, https://cdn.shop.com/b.png",
    "Image sources": "https://shop.com/products/acme-trail",
    Empty: "",
  };

  it("splits fields, image links and source pages by content, not column name", () => {
    const result = classifyRowValues(row, Object.keys(row));
    expect(result.fields.map((f) => f.column)).toEqual(["Title", "SKU"]);
    expect(result.fields[0]!.value).toBe("Acme Trail Shoe Blue");
    expect(result.imageUrls).toEqual(["https://cdn.shop.com/a.jpg", "https://cdn.shop.com/b.png"]);
    expect(result.sourceUrls).toEqual(["https://shop.com/products/acme-trail"]);
  });

  it("only reads selected columns", () => {
    const result = classifyRowValues(row, ["Title"]);
    expect(result.imageUrls).toEqual([]);
    expect(result.sourceUrls).toEqual([]);
    expect(textOnlyRow(result)).toEqual({ Title: "Acme Trail Shoe Blue" });
  });
});

describe("buildGalleryBrief", () => {
  const classified = classifyRowValues(
    {
      Title: "Acme Trail Shoe",
      "Image URLs": "https://cdn.shop.com/a.jpg",
      "Image sources": "https://shop.com/products/acme-trail",
    },
    ["Title", "Image URLs", "Image sources"]
  );

  it("attaches Main first, lists source pages and known images, and asks for reserves", () => {
    const brief = buildGalleryBrief({
      classified,
      mainImageUrls: ["https://cdn.shop.com/main.jpg"],
      count: 6,
      settings: { ...settings, instructions: "Prefer white background" },
      rowIdentifiers: ["AC-12345"],
    });
    expect(brief.inputImageUrls).toEqual(["https://cdn.shop.com/main.jpg", "https://cdn.shop.com/a.jpg"]);
    expect(brief.sourcePageUrls).toEqual(["https://shop.com/products/acme-trail"]);
    expect(brief.maxCandidates).toBe(9);
    expect(brief.text).toContain("## Known source pages (start here)");
    expect(brief.text).toContain("Open them first and scrape their galleries");
    expect(brief.text).toContain("- https://shop.com/products/acme-trail");
    expect(brief.text).not.toContain("Images the sheet already has");
    expect(brief.knownImageUrls).toEqual(["https://cdn.shop.com/main.jpg", "https://cdn.shop.com/a.jpg"]);
    expect(brief.text).toContain("6 NEW gallery images");
    expect(brief.text).toContain("Custom instruction (store owner, highest priority)");
    expect(brief.text).toContain("Prefer white background");
    expect(brief.text).toContain("Preferred minimum resolution: 1200px");
    expect(brief.text).toContain("AC-12345");
  });

  it("states plainly when a row has no source pages, images or codes", () => {
    const brief = buildGalleryBrief({
      classified: classifyRowValues({ Title: "Plain mug" }, ["Title"]),
      mainImageUrls: [],
      count: 1,
      settings: { ...settings, minResolution: 0, sourcePolicy: "official-only" },
      rowIdentifiers: [],
    });
    expect(brief.text).toContain("None attached.");
    expect(brief.text).toContain("None in the sheet");
    expect(brief.text).toContain("Use only official brand or manufacturer pages");
    expect(brief.text).toContain("no SKU, barcode or model code");
    expect(brief.maxCandidates).toBe(4);
  });

  it("caps the count at 12", () => {
    const brief = buildGalleryBrief({ classified, mainImageUrls: [], count: 99, settings });
    expect(brief.text).toContain("12 NEW gallery images");
  });
});
