import { describe, expect, it } from "vitest";
import type { ImageUrl } from "@/types";
import {
  collectOpenedPages,
  collectToolImages,
  countWebSearchCalls,
  looksLikeDirectImageUrl,
  looksLikeWebPageUrl,
  pickImagesFromSelection,
} from "./tool-results";
import type { OpenAiResponse } from "./types";

describe("looksLikeDirectImageUrl", () => {
  it("accepts image files and the usual image folders, including /medias/ shops", () => {
    expect(looksLikeDirectImageUrl("https://shop.test/a/b.jpg?v=1")).toBe(true);
    expect(looksLikeDirectImageUrl("https://shop.test/medias/?context=bWFzdGVy")).toBe(true);
    expect(looksLikeDirectImageUrl("https://shop.test/productimages/12345")).toBe(true);
    expect(looksLikeDirectImageUrl("https://shop.test/uploads/2024/05/abc")).toBe(true);
    expect(looksLikeDirectImageUrl("https://shop.test/files/12345")).toBe(true);
    expect(looksLikeDirectImageUrl("https://shop.test/content/dam/x/y")).toBe(true);
  });

  it("refuses http links and pages", () => {
    expect(looksLikeDirectImageUrl("http://shop.test/a.jpg")).toBe(false);
    expect(looksLikeDirectImageUrl("https://shop.test/media/page.html")).toBe(false);
  });
});

describe("looksLikeWebPageUrl", () => {
  it("is true only for home pages and page extensions", () => {
    expect(looksLikeWebPageUrl("https://shop.test")).toBe(true);
    expect(looksLikeWebPageUrl("https://shop.test/")).toBe(true);
    expect(looksLikeWebPageUrl("https://shop.test/p/gallery.html")).toBe(true);
    expect(looksLikeWebPageUrl("https://shop.test/image.php")).toBe(true);
    expect(looksLikeWebPageUrl("not a url")).toBe(true);
    expect(looksLikeWebPageUrl("https://shop.test/medias/?context=abc")).toBe(false);
    expect(looksLikeWebPageUrl("https://shop.test/getImage?id=12")).toBe(false);
    expect(looksLikeWebPageUrl("https://shop.test/a/b.jpg")).toBe(false);
  });
});

describe("collectOpenedPages", () => {
  it("lists the pages web_search opened or searched within, and pages cited in the answer", () => {
    const response: OpenAiResponse = {
      output: [
        { type: "web_search_call", action: { type: "search", query: "a" } },
        { type: "web_search_call", action: { type: "open_page", url: "https://shop.test/p/1" } },
        { type: "web_search_call", action: { type: "find_in_page", url: "https://shop.test/p/2" } },
        { type: "web_search_call", action: { type: "open_page" } },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "{}",
              annotations: [{ type: "url_citation", url: "https://www.toysrus.es/p/K1048394" }],
            },
          ],
        },
      ],
    };
    expect(collectOpenedPages(response)).toEqual([
      "https://shop.test/p/1",
      "https://shop.test/p/2",
      "https://www.toysrus.es/p/K1048394",
    ]);
  });
});

describe("countWebSearchCalls", () => {
  it("bills search actions only, not page navigation", () => {
    const response: OpenAiResponse = {
      output: [
        { type: "reasoning" },
        { type: "web_search_call", action: { type: "search", query: "a" } },
        { type: "web_search_call", action: { type: "open_page" } },
        { type: "web_search_call", action: { type: "find_in_page" } },
        { type: "web_search_call", action: { type: "search", queries: ["b", "c"] } },
        { type: "message" },
      ],
    };
    expect(countWebSearchCalls(response)).toBe(2);
  });

  it("counts calls without an action so older payloads are never under-billed", () => {
    expect(
      countWebSearchCalls({ output: [{ type: "web_search_call" }] })
    ).toBe(1);
  });

  it("returns 0 when nothing was searched", () => {
    expect(countWebSearchCalls({})).toBe(0);
    expect(countWebSearchCalls({ output: [{ type: "message" }] })).toBe(0);
  });
});

describe("collectToolImages", () => {
  it("keeps an image_result whose path has no extension, and drops a page", () => {
    const response: OpenAiResponse = {
      output: [
        {
          type: "web_search_call",
          results: [
            {
              type: "image_result",
              image_url: "https://www.toysrus.es/medias/?context=bWFzdGVy",
              source_website_url: "https://www.toysrus.es/p/K1048394",
            },
            {
              type: "image_result",
              image_url: "https://www.toysrus.es/Motor-y-Co/p/K1048394.html",
              source_website_url: "https://www.toysrus.es/p/K1048394",
            },
          ],
        },
      ],
    };
    expect(collectToolImages(response).map((image) => image.imageUrl)).toEqual([
      "https://www.toysrus.es/medias/?context=bWFzdGVy",
    ]);
  });
});

describe("pickImagesFromSelection", () => {
  const tool: ImageUrl[] = [
    { imageUrl: "https://cdn.example.com/a.jpg", pageUrl: "https://example.com/a", title: "A" },
    { imageUrl: "https://cdn.example.com/b.jpg", pageUrl: "https://example.com/b", title: "B" },
    { imageUrl: "https://cdn.example.com/c.jpg", pageUrl: "https://example.com/c", title: "C" },
  ];

  it("pads from the tool pool by default", () => {
    const picked = pickImagesFromSelection(["https://cdn.example.com/b.jpg"], tool, 3);
    expect(picked.map((p) => p.imageUrl)).toEqual([
      "https://cdn.example.com/b.jpg",
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/c.jpg",
    ]);
  });

  it("keeps only approved exact matches when pad is false", () => {
    const picked = pickImagesFromSelection(
      [
        "https://cdn.example.com/b.jpg",
        "https://example.com/a", // page URL, not an image_url
        "https://cdn.example.com/invented.jpg",
      ],
      tool,
      3,
      { pad: false }
    );
    expect(picked.map((p) => p.imageUrl)).toEqual(["https://cdn.example.com/b.jpg"]);
  });

  it("returns nothing when the model approves nothing and pad is false", () => {
    expect(pickImagesFromSelection([], tool, 3, { pad: false })).toEqual([]);
  });
});
