import { describe, expect, it } from "vitest";
import { enrichedValueToText } from "./export-values";

describe("enrichedValueToText for URL lists", () => {
  const images = [
    { imageUrl: "https://cdn.test/a.jpg", pageUrl: "https://shop.test/p/1", title: "A" },
    { imageUrl: "https://cdn.test/b.jpg", pageUrl: "https://shop.test/p/2", title: "B" },
  ];
  const sources = [
    { title: "shop.test", uri: "https://shop.test/p/1" },
    { title: "other.test", uri: "https://other.test/p/2" },
  ];

  it("exports Image URLs as one image link per line", () => {
    expect(enrichedValueToText(images, "imageUrls")).toBe("https://cdn.test/a.jpg\nhttps://cdn.test/b.jpg");
  });

  it("exports Image sources as one page link per line, not the image links", () => {
    expect(enrichedValueToText(sources, "imageSourceUrls")).toBe("https://shop.test/p/1\nhttps://other.test/p/2");
  });

  it("keeps the Enrich-mode Source URLs column working", () => {
    expect(enrichedValueToText(sources, "sourceUrls")).toBe("https://shop.test/p/1\nhttps://other.test/p/2");
  });

  it("decides by entry shape for a column it has no special case for", () => {
    expect(enrichedValueToText(sources, "somethingElse")).toBe("https://shop.test/p/1\nhttps://other.test/p/2");
    expect(enrichedValueToText(images, "somethingElse")).toBe("https://cdn.test/a.jpg\nhttps://cdn.test/b.jpg");
  });

  it("exports an empty list as an empty cell", () => {
    expect(enrichedValueToText([], "imageSourceUrls")).toBe("");
    expect(enrichedValueToText(undefined, "imageSourceUrls")).toBe("");
  });
});
