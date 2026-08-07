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

vi.mock("./openai-web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openai-web")>();
  return {
    ...actual,
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
  };
});

import { searchProduct, searchProductImages } from "@/lib/gemini";
import {
  parseSyncImageSelection,
  resolveGroundedImageSelection,
  searchImagesWithOpenAiWeb,
} from "./openai-web";
import { researchWithWeb, searchImagesForRows } from "./ai-helpers";

const toolPool = [
  {
    imageUrl: "https://cdn.example/pack.jpg",
    pageUrl: "https://shop.example/html-page",
  },
  {
    imageUrl: "https://cdn.example/side.webp",
    pageUrl: "https://shop.example/side",
  },
];

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

describe("precision-first Sol selection", () => {
  it("parses found + null abstain selections", () => {
    expect(
      parseSyncImageSelection({
        status: "found",
        selectedImageUrl: "https://cdn.example/pack.jpg",
        notes: "exact",
      })
    ).toEqual({
      status: "found",
      selectedImageUrl: "https://cdn.example/pack.jpg",
      notes: "exact",
    });

    expect(
      parseSyncImageSelection({
        status: "no_confident_match",
        selectedImageUrl: null,
        notes: "near miss only",
      })
    ).toEqual({
      status: "no_confident_match",
      selectedImageUrl: null,
      notes: "near miss only",
    });

    expect(
      parseSyncImageSelection({
        status: "found",
        selectedImageUrl: "",
        notes: "bad",
      })?.selectedImageUrl
    ).toBeNull();
  });

  it("accepts grounded found selection", () => {
    const grounded = resolveGroundedImageSelection({
      selection: {
        status: "found",
        selectedImageUrl: "https://cdn.example/pack.jpg",
        notes: "ok",
      },
      toolImages: toolPool,
    });
    expect(grounded?.imageUrl).toBe("https://cdn.example/pack.jpg");
  });

  it("abstains on no_confident_match even if tool pool has images", () => {
    expect(
      resolveGroundedImageSelection({
        selection: {
          status: "no_confident_match",
          selectedImageUrl: null,
          notes: "no exact match",
        },
        toolImages: toolPool,
      })
    ).toBeNull();
  });

  it("abstains on ungounded URL (not in tool pool)", () => {
    expect(
      resolveGroundedImageSelection({
        selection: {
          status: "found",
          selectedImageUrl: "https://evil.example/fake.jpg",
          notes: "invented",
        },
        toolImages: toolPool,
      })
    ).toBeNull();
  });

  it("abstains when selection is missing — never first tool image", () => {
    expect(
      resolveGroundedImageSelection({
        selection: null,
        toolImages: toolPool,
      })
    ).toBeNull();
  });
});
