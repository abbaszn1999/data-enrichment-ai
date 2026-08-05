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
    expect(request.model).toBe("gpt-5.6-terra");
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(request.tools[0]).toMatchObject({
      type: "web_search",
      search_content_types: ["image", "text"],
      search_context_size: "medium",
      external_web_access: true,
      image_settings: {
        caption: true,
      },
    });
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
                    galleryImageUrls: [galleryThumbnail],
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
      mainImages: [
        {
          buffer: Buffer.from("image"),
          contentType: "image/webp",
          url: "https://example.com/main.webp",
        },
      ],
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.model).toBe("gpt-5.6-terra");
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

  it("attaches Main as a public HTTPS image_url per OpenAI vision docs", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    productIdentity: "Brand SKU",
                    galleryImageUrls: ["https://cdn.example/g.jpg"],
                    notes: "ok",
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchScrapingGalleryImages({
      rowData: { SKU: "SKU" },
      selectedColumns: ["SKU"],
      settings: {
        ...DEFAULT_SCRAPING_SETTINGS,
        imagesPerRow: 1,
      },
      requestedGalleryImages: 1,
      mainImages: [{ url: "https://cdn.example/main.jpg" }],
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.input[0].content[0]).toEqual({
      type: "input_image",
      image_url: "https://cdn.example/main.jpg",
      detail: "high",
    });
  });

  it("attaches every Main image and blocks all of their URLs", async () => {
    process.env.OPENAI_API_KEY = "test-key";
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
                  image_url: "https://cdn.example/side.jpg",
                  source_website_url: "https://brand.example/product",
                  caption: "Side",
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
                      "https://example.com/main-1.webp",
                      "https://cdn.example/side.jpg",
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
      mainImages: [
        {
          buffer: Buffer.from("front"),
          contentType: "image/webp",
          url: "https://example.com/main-1.webp",
        },
        {
          buffer: Buffer.from("back"),
          contentType: "image/webp",
          url: "https://example.com/main-2.webp",
        },
      ],
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const content = request.input[0].content;
    expect(content.filter((part: { type: string }) => part.type === "input_image")).toHaveLength(2);
    expect(content.find((part: { type: string }) => part.type === "input_text").text).toContain(
      "The 2 attached images are the trusted Main images"
    );
    expect(content.find((part: { type: string }) => part.type === "input_text").text).toContain(
      "https://example.com/main-1.webp"
    );
    expect(content.find((part: { type: string }) => part.type === "input_text").text).toContain(
      "https://example.com/main-2.webp"
    );
    expect(result.galleryCandidates.map((c) => c.imageUrl)).toEqual([
      "https://cdn.example/side.jpg",
    ]);
  });

  it("trusts model-selected Gallery URLs directly, even without a matching raw search result", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const modelUrl = "https://brand.example/gallery/side-view.jpg";
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
                  image_url: "https://cdn.example/unrelated.jpg",
                  source_website_url: "https://brand.example/product",
                  caption: "Some other result",
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
                    galleryImageUrls: [modelUrl],
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
      mainImages: [
        {
          buffer: Buffer.from("image"),
          contentType: "image/webp",
          url: "https://example.com/main.webp",
        },
      ],
    });

    expect(result.galleryCandidates.map((c) => c.imageUrl)).toEqual([modelUrl]);
  });

  it("uses gpt-5.6-sol when Scraping tier is premium", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    productIdentity: "Exact Product",
                    galleryImageUrls: [],
                    notes: "",
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchScrapingGalleryImages({
      rowData: { SKU: "123" },
      selectedColumns: ["SKU"],
      settings: {
        ...DEFAULT_SCRAPING_SETTINGS,
        tier: "premium",
      },
      requestedGalleryImages: 2,
      mainImages: [
        {
          buffer: Buffer.from("image"),
          contentType: "image/webp",
          url: "https://example.com/main.webp",
        },
      ],
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.model).toBe("gpt-5.6-sol");
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.tools[0].search_context_size).toBe("high");
  });
});
