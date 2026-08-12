import { describe, expect, it } from "vitest";

import {
  DEFAULT_GALLERY_IMAGE_COUNT,
  GALLERY_SEPARATOR,
  MAX_GALLERY_IMAGE_COUNT,
  buildGalleryMediaIndex,
  clampGalleryImageCount,
  mergeGalleryImages,
  parseGalleryImages,
  parseGalleryMedia,
  serializeGalleryImages,
} from "./gallery-images";

describe("parseGalleryImages", () => {
  it("reads the canonical pipe-separated cell", () => {
    expect(parseGalleryImages(`a.jpg${GALLERY_SEPARATOR}b.jpg`)).toEqual([
      "a.jpg",
      "b.jpg",
    ]);
  });

  it("keeps commas inside URLs intact", () => {
    const url =
      "https://res.cloudinary.com/demo/image/upload/w_400,h_400,c_fill/shoe.jpg";
    expect(parseGalleryImages(url)).toEqual([url]);
  });

  it("accepts newline-separated input and arrays", () => {
    expect(parseGalleryImages("a.jpg\nb.jpg")).toEqual(["a.jpg", "b.jpg"]);
    expect(parseGalleryImages(["a.jpg", " b.jpg "])).toEqual(["a.jpg", "b.jpg"]);
  });

  it("drops blanks and case-insensitive duplicates", () => {
    expect(parseGalleryImages(" A.jpg | a.jpg |  | b.jpg ")).toEqual([
      "A.jpg",
      "b.jpg",
    ]);
  });

  it("returns nothing for empty values", () => {
    expect(parseGalleryImages(null)).toEqual([]);
    expect(parseGalleryImages("   ")).toEqual([]);
  });
});

describe("serializeGalleryImages", () => {
  it("round-trips through parse", () => {
    const urls = ["https://x/1.jpg", "https://x/2.jpg"];
    expect(parseGalleryImages(serializeGalleryImages(urls))).toEqual(urls);
  });
});

describe("parseGalleryMedia", () => {
  it("reads platform id/src pairs and survives a JSON round-trip", () => {
    const media = [{ id: "gid://shopify/MediaImage/1", src: "https://cdn/1.jpg" }];
    expect(parseGalleryMedia(media)).toEqual(media);
    expect(parseGalleryMedia(JSON.stringify(media))).toEqual(media);
  });

  it("ignores junk instead of throwing", () => {
    expect(parseGalleryMedia("not json")).toEqual([]);
    expect(parseGalleryMedia([null, {}, { src: "" }])).toEqual([]);
  });

  it("indexes media by URL regardless of casing", () => {
    const index = buildGalleryMediaIndex([{ id: "42", src: "https://CDN/1.jpg" }]);
    expect(index.get("https://cdn/1.jpg")?.id).toBe("42");
  });
});

describe("clampGalleryImageCount", () => {
  it("falls back to the default when no number is given", () => {
    expect(clampGalleryImageCount(undefined)).toBe(DEFAULT_GALLERY_IMAGE_COUNT);
    expect(clampGalleryImageCount(0)).toBe(DEFAULT_GALLERY_IMAGE_COUNT);
    expect(clampGalleryImageCount("nonsense")).toBe(DEFAULT_GALLERY_IMAGE_COUNT);
  });

  it("honours an explicit number up to the ceiling", () => {
    expect(clampGalleryImageCount(2)).toBe(2);
    expect(clampGalleryImageCount(MAX_GALLERY_IMAGE_COUNT)).toBe(
      MAX_GALLERY_IMAGE_COUNT
    );
    expect(clampGalleryImageCount(99)).toBe(MAX_GALLERY_IMAGE_COUNT);
  });
});

describe("mergeGalleryImages", () => {
  it("appends without disturbing existing images", () => {
    const merged = mergeGalleryImages({
      existing: "a.jpg | b.jpg",
      incoming: ["c.jpg"],
    });
    expect(merged.urls).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(merged.added).toEqual(["c.jpg"]);
  });

  it("never adds the featured image or an existing duplicate", () => {
    const merged = mergeGalleryImages({
      existing: "a.jpg",
      incoming: ["A.jpg", "main.jpg", "new.jpg", ""],
      featuredImage: "MAIN.jpg",
    });
    expect(merged.urls).toEqual(["a.jpg", "new.jpg"]);
    expect(merged.added).toEqual(["new.jpg"]);
    expect(merged.skipped).toBe(3);
  });

  it("replaces the gallery when overwrite is set", () => {
    const merged = mergeGalleryImages({
      existing: "a.jpg | b.jpg",
      incoming: ["c.jpg"],
      overwrite: true,
    });
    expect(merged.urls).toEqual(["c.jpg"]);
  });
});
