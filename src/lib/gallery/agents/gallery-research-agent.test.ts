import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedPage } from "@/lib/enrich/image-finder/tools/fetch-page";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";

const openai = vi.hoisted(() => ({ runEnrichOpenAiResponse: vi.fn() }));
const preview = vi.hoisted(() => ({ loadImagePreview: vi.fn() }));

vi.mock("@/lib/enrich/openai", () => ({ runEnrichOpenAiResponse: openai.runEnrichOpenAiResponse }));
vi.mock("@/lib/enrich/image-finder/tools/view-images", () => ({ loadImagePreview: preview.loadImagePreview }));
vi.mock("@/lib/enrich/image-finder/verify-images", () => ({
  keepLoadableImages: async (candidates: unknown[], limit: number) => ({
    images: candidates.slice(0, limit),
    unverified: 0,
  }),
  unverifiedImagesNote: () => "",
}));
vi.mock("@/lib/gallery/log", () => ({ galleryLog: vi.fn() }));

import { researchGalleryImages } from "./gallery-research-agent";

const settings: GalleryScrapingSettings = {
  instructions: "",
  sourcePolicy: "any",
  minResolution: 0,
  aspectRatio: "any",
  searchDepth: "medium",
} as GalleryScrapingSettings;

const SOURCE_PAGE = "https://shop.com/products/acme-trail";

function page(images: string[]): CachedPage {
  return {
    at: Date.now(),
    status: 200,
    finalUrl: SOURCE_PAGE,
    body: "",
    extract: { images } as CachedPage["extract"],
  };
}

function respondWith(answer: Record<string, unknown>, searchImages: string[] = []) {
  openai.runEnrichOpenAiResponse.mockImplementation(async (params: { parse: (input: unknown) => Promise<{ images: unknown[] }> }) => {
    const data = await params.parse({
      selection: answer,
      response: {
        output: [
          {
            type: "web_search_call",
            results: searchImages.map((url) => ({
              type: "image_result",
              image_url: url,
              source_website_url: "https://other.com/p",
              caption: "photo",
            })),
          },
        ],
      },
    });
    return { data, costs: [{ costUsd: 0.1 }], searchCallCount: 1, model: "gpt-6.1-sol" };
  });
}

const baseParams = {
  rowData: { Title: "Acme Trail Shoe", "Image sources": SOURCE_PAGE },
  selectedColumns: ["Title", "Image sources"],
  mainImageUrls: ["https://cdn.shop.com/main.jpg"],
  settings,
  requestedGalleryImages: 3,
};

beforeEach(() => {
  openai.runEnrichOpenAiResponse.mockReset();
  preview.loadImagePreview.mockReset();
  preview.loadImagePreview.mockResolvedValue({ ok: true, width: 1000, height: 1000 });
});

describe("researchGalleryImages (single request)", () => {
  it("makes exactly one request with no function tools and lists photos read from the source page", async () => {
    respondWith({ status: "found", productIdentity: "Acme Trail Shoe", images: [], notes: "" });
    await researchGalleryImages({ ...baseParams, loadPage: async () => page(["https://cdn.shop.com/p/side.jpg"]) });
    expect(openai.runEnrichOpenAiResponse).toHaveBeenCalledTimes(1);
    const call = openai.runEnrichOpenAiResponse.mock.calls[0]![0];
    expect(call.functionTools).toBeUndefined();
    expect(call.policy.searchContentTypes).toEqual(["image", "text"]);
    expect(call.policy.includeResults).toBe(true);
    expect(call.promptText).toContain("## Photos already read from the known source pages");
    expect(call.promptText).toContain("- https://cdn.shop.com/p/side.jpg");
  });

  it("keeps links seen on the source page or in the search results and drops invented ones", async () => {
    respondWith(
      {
        status: "found",
        productIdentity: "Acme Trail Shoe",
        images: [
          { url: "https://cdn.shop.com/p/side.jpg", pageUrl: SOURCE_PAGE, perspective: "side" },
          { url: "https://cdn.found.com/img/back.jpg", pageUrl: "", perspective: "back" },
          { url: "https://cdn.invented.com/img/made-up.jpg", pageUrl: "", perspective: "top" },
          { url: "https://cdn.shop.com/main.jpg", pageUrl: SOURCE_PAGE, perspective: "front" },
        ],
        notes: "ok",
      },
      ["https://cdn.found.com/img/back.jpg"]
    );
    const result = await researchGalleryImages({
      ...baseParams,
      loadPage: async () => page(["https://cdn.shop.com/p/side.jpg", "https://cdn.shop.com/main.jpg"]),
    });
    expect(result.images.map((i) => i.imageUrl)).toEqual([
      "https://cdn.shop.com/p/side.jpg",
      "https://cdn.found.com/img/back.jpg",
    ]);
    expect(result.rejections).toHaveLength(2);
    expect(result.costs).toHaveLength(1);
    expect(result.stats.pagesOpened).toBe(1);
  });

  it("drops images that are tiny once measured", async () => {
    preview.loadImagePreview.mockResolvedValue({ ok: true, width: 80, height: 80 });
    respondWith(
      {
        status: "found",
        productIdentity: "x",
        images: [{ url: "https://cdn.found.com/img/icon.jpg", pageUrl: "", perspective: "other" }],
        notes: "",
      },
      ["https://cdn.found.com/img/icon.jpg"]
    );
    const result = await researchGalleryImages({ ...baseParams, rowData: { Title: "Acme" }, selectedColumns: ["Title"] });
    expect(result.images).toHaveLength(0);
  });
});
