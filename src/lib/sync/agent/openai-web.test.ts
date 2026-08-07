import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAiResponse } from "@/lib/enrich/types";
import { collectToolImages, looksLikeDirectImageUrl } from "@/lib/enrich/parse";

vi.mock("@/lib/gemini", () => ({
  searchProduct: vi.fn(async () => ({
    text: "gemini summary",
    sources: [{ title: "G", uri: "https://gemini.example/p" }],
    cost: {
      model: "gemini-3.6-flash",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      inputCost: 0,
      outputCost: 0,
      searchCost: 0,
      serperCost: 0,
      serpApiCost: 0,
      totalCost: 0.01,
    },
  })),
  searchProductImages: vi.fn(async () => [
    {
      imageUrl: "https://cdn.example/serper.jpg",
      pageUrl: "https://shop.example/p",
      title: "Serper image",
    },
  ]),
}));

vi.mock("./openai-web", () => ({
  searchImagesWithOpenAiWeb: vi.fn(async () => ({
    imageUrl: "https://cdn.example/sol.webp",
    pageUrl: "https://brand.example/p",
    query: "Widget Sol",
    cost: {
      model: "gpt-5.6-sol",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      inputCost: 0,
      outputCost: 0,
      searchCost: 0,
      serperCost: 0,
      serpApiCost: 0,
      totalCost: 0.03,
    },
  })),
}));

import { searchProduct, searchProductImages } from "@/lib/gemini";
import { searchImagesWithOpenAiWeb } from "./openai-web";
import { researchWithWeb, searchImagesForRows } from "./ai-helpers";

describe("Sync Pro OpenAI images-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looksLikeDirectImageUrl rejects catalogue pages", () => {
    expect(looksLikeDirectImageUrl("https://cdn.example/a.jpg")).toBe(true);
    expect(
      looksLikeDirectImageUrl("https://www.retailer.com/en/product/foo")
    ).toBe(false);
  });

  it("collectToolImages keeps image_url only", () => {
    const response: OpenAiResponse = {
      status: "completed",
      output: [
        {
          type: "web_search_call",
          results: [
            {
              type: "image_result",
              image_url: "https://cdn.example/pack.jpg",
              source_website_url: "https://shop.example/html-page",
              caption: "Pack",
            },
          ],
        },
      ],
    };
    const images = collectToolImages(response);
    expect(images.map((i) => i.imageUrl)).toEqual([
      "https://cdn.example/pack.jpg",
    ]);
  });

  it("researchWithWeb always uses Gemini (Fast and Pro)", async () => {
    for (const mode of ["fast", "pro"] as const) {
      vi.clearAllMocks();
      const result = await researchWithWeb({
        instruction: "research widget",
        integration: { provider: "shopify", integration_name: "Store" },
        sheet: null,
        mode,
      });
      expect(result.summary).toBe("gemini summary");
      expect(searchProduct).toHaveBeenCalledOnce();
    }
  });

  it("searchImagesForRows uses Serper on Fast", async () => {
    const results = await searchImagesForRows({
      rows: [{ title: "Widget", vendor: "Acme" }],
      instruction: "packshot",
      mode: "fast",
    });
    expect(results[0]?.imageUrl).toBe("https://cdn.example/serper.jpg");
    expect(searchProductImages).toHaveBeenCalledOnce();
    expect(searchImagesWithOpenAiWeb).not.toHaveBeenCalled();
  });

  it("searchImagesForRows uses OpenAI Sol on Pro", async () => {
    const results = await searchImagesForRows({
      rows: [{ title: "Widget", vendor: "Acme" }],
      instruction: "packshot",
      mode: "pro",
    });
    expect(results[0]?.imageUrl).toBe("https://cdn.example/sol.webp");
    expect(searchImagesWithOpenAiWeb).toHaveBeenCalledOnce();
    expect(searchProductImages).not.toHaveBeenCalled();
  });
});
