import { beforeEach, describe, expect, it, vi } from "vitest";
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

function respondWith(answer: Record<string, unknown>) {
  openai.runEnrichOpenAiResponse.mockImplementation(
    async (params: { parse: (input: unknown) => Promise<{ images: unknown[] }> }) => {
      const data = await params.parse({ selection: answer, response: { output: [] } });
      return { data, costs: [{ costUsd: 0.1 }], searchCallCount: 1, model: "gpt-6.1-sol" };
    }
  );
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
  it("makes exactly one request with no function tools and hands the source URLs to the agent", async () => {
    respondWith({ status: "found", productIdentity: "Acme Trail Shoe", images: [], notes: "" });
    const result = await researchGalleryImages(baseParams);
    expect(openai.runEnrichOpenAiResponse).toHaveBeenCalledTimes(1);
    const call = openai.runEnrichOpenAiResponse.mock.calls[0]![0];
    expect(call.functionTools).toBeUndefined();
    expect(call.policy.searchContentTypes).toEqual(["image", "text"]);
    expect(call.promptText).toContain("## Known source pages (start here)");
    expect(call.promptText).toContain(`- ${SOURCE_PAGE}`);
    expect(result.stats.pagesOpened).toBe(1);
  });

  it("drops images the sheet has and repeats, keeps the rest in order", async () => {
    respondWith({
      status: "found",
      productIdentity: "Acme Trail Shoe",
      images: [
        { url: "https://cdn.shop.com/p/side.jpg", pageUrl: SOURCE_PAGE, perspective: "side" },
        { url: "https://cdn.shop.com/main.jpg", pageUrl: SOURCE_PAGE, perspective: "front" },
        { url: "https://cdn.shop.com/p/side.jpg", pageUrl: SOURCE_PAGE, perspective: "side" },
        { url: "https://cdn.found.com/img/back.jpg", pageUrl: "", perspective: "back" },
      ],
      notes: "ok",
    });
    const result = await researchGalleryImages(baseParams);
    expect(result.images.map((i) => i.imageUrl)).toEqual([
      "https://cdn.shop.com/p/side.jpg",
      "https://cdn.found.com/img/back.jpg",
    ]);
    expect(result.costs).toHaveLength(1);
  });

  it("drops images that are tiny once measured", async () => {
    preview.loadImagePreview.mockResolvedValue({ ok: true, width: 80, height: 80 });
    respondWith({
      status: "found",
      productIdentity: "x",
      images: [{ url: "https://cdn.found.com/img/icon.jpg", pageUrl: "", perspective: "other" }],
      notes: "",
    });
    const result = await researchGalleryImages({ ...baseParams, rowData: { Title: "Acme" }, selectedColumns: ["Title"] });
    expect(result.images).toHaveLength(0);
  });
});
