import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCRAPING_SETTINGS } from "@/lib/gallery/types";
import { searchScrapingMainImages } from "@/lib/gallery/agents/scraping-main-agent";
import { searchScrapingGalleryImages } from "@/lib/gallery/agents/scraping-gallery-agent";

const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.OPENAI_API_KEY = originalKey;
});

describe("Scraping Main agent", () => {
  it("uses a Main-only schema and prompt", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const canonicalMain = "https://cdn.example/main.jpg";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "web_search_call",
              results: [
                {
                  type: "image_result",
                  image_url: canonicalMain,
                  source_website_url: "https://brand.example/product",
                  caption: "Exact product front",
                },
              ],
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    productIdentity: "Exact Product 123",
                    mainImageUrls: [canonicalMain],
                    notes: "",
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 1000, output_tokens: 100 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchScrapingMainImages({
      rowData: { SKU: "123", Name: "Exact Product" },
      selectedColumns: ["SKU", "Name"],
      settings: {
        ...DEFAULT_SCRAPING_SETTINGS,
        main: {
          imagesPerRow: 2,
          instructions: "Use clean front-facing packshots",
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.mainCandidates.map((c) => c.imageUrl)).toEqual([canonicalMain]);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.text.format.name).toBe("product_main_selection");
    expect(request.text.format.schema.required).toEqual([
      "productIdentity",
      "mainImageUrls",
      "notes",
    ]);
    expect(request.text.format.schema.properties.galleryImageUrls).toBeUndefined();
    expect(request.text.format.schema.properties.mainImageUrls.maxItems).toBe(2);
    expect(request.input[0].content[0].text).toContain(
      "Use clean front-facing packshots"
    );
    expect(request.input[0].content[0].text).not.toContain(
      "Gallery images must be meaningfully different"
    );
  });

  it("accepts Main URLs that only differ by CDN query params", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const searchUrl =
      "https://feel22.com/cdn/shop/files/Packshot.png?v=1746715312";
    const modelUrl =
      "https://feel22.com/cdn/shop/files/Packshot.png?v=1746715312&width=720";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "web_search_call",
              results: [
                {
                  type: "image_result",
                  image_url: searchUrl,
                  source_website_url: "https://feel22.com/product",
                  caption: "Packshot",
                },
              ],
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    productIdentity: "Ultra Doux Papaya",
                    mainImageUrls: [modelUrl],
                    notes: "Exact packshot",
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchScrapingMainImages({
      rowData: { Name: "Ultra Doux Hair Food Papaya & Amla Shampoo 350 Ml" },
      selectedColumns: ["Name"],
      settings: DEFAULT_SCRAPING_SETTINGS,
    });

    expect(result.mainCandidates).toHaveLength(1);
    expect(result.mainCandidates[0]?.imageUrl).toBe(modelUrl);
  });
});

describe("Scraping Gallery agent", () => {
  it("uses a Gallery-only schema with Main as visual reference", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const galleryThumbnail = "https://tse.example/side-thumb.jpg";
    const canonicalGallery = "https://cdn.example/side.jpg";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "web_search_call",
              results: [
                {
                  type: "image_result",
                  image_url: canonicalGallery,
                  thumbnail_url: galleryThumbnail,
                  source_website_url: "https://brand.example/product",
                  caption: "Exact product side",
                },
              ],
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    productIdentity: "Exact Product",
                    galleryImageUrls: [
                      galleryThumbnail,
                      "https://fabricated.example/not-in-search.jpg",
                    ],
                    notes: "",
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchScrapingGalleryImages({
      rowData: { SKU: "123" },
      selectedColumns: ["SKU"],
      settings: DEFAULT_SCRAPING_SETTINGS,
      requestedGalleryImages: 3,
      mainImage: {
        buffer: Buffer.from("image"),
        contentType: "image/webp",
        url: "https://example.com/main.webp",
      },
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.text.format.name).toBe("product_gallery_selection");
    expect(request.text.format.schema.required).toEqual([
      "productIdentity",
      "galleryImageUrls",
      "notes",
    ]);
    expect(request.text.format.schema.properties.mainImageUrls).toBeUndefined();
    expect(request.input[0].content[0]).toMatchObject({
      type: "input_image",
      detail: "high",
    });
    expect(request.input[0].content[0].image_url).toMatch(
      /^data:image\/webp;base64,/
    );
    expect(request.input[0].content[1].text).toContain(
      "Gallery images must be meaningfully different"
    );
    expect(result.galleryCandidates.map((c) => c.imageUrl)).toEqual([
      galleryThumbnail,
    ]);
  });
});
