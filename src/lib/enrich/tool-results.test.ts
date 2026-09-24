import { describe, expect, it } from "vitest";
import type { ImageUrl } from "@/types";
import { countWebSearchCalls, pickImagesFromSelection } from "./tool-results";
import type { OpenAiResponse } from "./types";

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
