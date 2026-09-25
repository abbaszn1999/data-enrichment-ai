import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost } from "@/lib/ai-pricing";
import { enrichRow } from "../agent";
import { EnrichBilledAttemptError, OPENAI_RESPONSES_URL } from "../openai";
import { imageFinderNotFoundKey } from "./not-found";
import { IMAGE_FINDER_SKILL } from "./skill";

const notFoundKey = imageFinderNotFoundKey("imageUrls");

const usage = {
  input_tokens: 3_000,
  input_tokens_details: { cached_tokens: 1_000 },
  output_tokens: 800,
  output_tokens_details: { reasoning_tokens: 600 },
  total_tokens: 3_800,
};

function openAiBody(selection: unknown, status = "completed") {
  return {
    status,
    usage,
    output: [
      { type: "web_search_call", action: { type: "search", query: "Widget WX-1" } },
      { type: "web_search_call", action: { type: "open_page" } },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(selection) }],
      },
    ],
  };
}

/** image/jpeg for every URL by default; per-URL overrides let a test simulate a dead or non-image link. */
function imageVerificationMock(overrides: Record<string, { status?: number; contentType?: string }> = {}) {
  return vi.fn((input: string, init: { method?: string }) => {
    if (input === OPENAI_RESPONSES_URL) throw new Error("OpenAI call should be mocked separately");
    const override = overrides[input];
    const status = override?.status ?? 200;
    const contentType = override && "contentType" in override ? override.contentType : "image/jpeg";
    return Promise.resolve(
      new Response(init.method === "HEAD" ? null : new Uint8Array([1, 2, 3]), {
        status,
        headers: contentType ? { "content-type": contentType } : {},
      })
    );
  });
}

const params = {
  productData: { Brand: "Acme", Title: "Widget WX-1" },
  enabledColumns: ["imageUrls"],
  enrichmentColumns: [
    {
      id: "imageUrls",
      label: "Image URLs",
      description: "",
      type: "imageUrls" as const,
      enabled: true,
      imageCount: 2,
      customInstruction: "Front view first",
    },
  ],
  settings: { enrichmentModel: "standard" as const, outputLanguage: "English" },
  kind: "product" as const,
};

describe("Image Finder agent", () => {
  let verifyMock: ReturnType<typeof imageVerificationMock>;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    verifyMock = imageVerificationMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Combines a one-shot OpenAI response with the shared image-verification mock. */
  function stubFetch(openAiResponseBody: unknown) {
    const fetchMock = vi.fn((input: string, init: { method?: string; body?: string }) => {
      if (input === OPENAI_RESPONSES_URL) {
        return Promise.resolve(new Response(JSON.stringify(openAiResponseBody), { status: 200 }));
      }
      return verifyMock(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends the skill, structured brief and gpt-6-sol, and bills only search actions", async () => {
    const fetchMock = stubFetch(
      openAiBody({
        images: [
          {
            url: "https://cdn.example.com/b.jpg",
            confidence: "high",
            matchedOn: "SKU verified on source page",
          },
        ],
        notes: "Confident match",
      })
    );

    const result = await enrichRow(params);

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.model).toBe("gpt-6-sol");
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(request.instructions).toBe(IMAGE_FINDER_SKILL);
    expect(request.tool_choice).toBe("required");
    expect(request.tools[0]).toMatchObject({
      type: "web_search",
      search_context_size: "medium",
      search_content_types: ["image", "text"],
      return_token_budget: "unlimited",
      // Over-fetches well beyond the requested 2, so the model has real
      // candidates to choose from instead of being handed exactly the target.
      image_settings: { max_results: 20, caption: true },
    });
    expect(request.text.format.name).toBe("catalog_image_finder");
    expect(request.text.format.schema.properties.images.maxItems).toBe(2);
    const prompt = request.input[0].content.at(-1).text as string;
    expect(prompt).toContain("- Brand: Acme");
    expect(prompt).toContain(
      "## Custom instruction (store owner, highest priority)\nFront view first"
    );
    expect(request.tools[0].filters).toBeUndefined();

    // The reported URL is verified live rather than matched against a
    // separate image-search field — high confidence leaves the caption as is.
    expect(result.data).toEqual({
      imageUrls: [
        expect.objectContaining({ imageUrl: "https://cdn.example.com/b.jpg", title: "Product image" }),
      ],
      [notFoundKey]: "",
    });
    expect(result.costs).toHaveLength(1);
    const expected = calculateOpenAiWebSearchCost("gpt-6-sol", usage, 1);
    expect(result.costs[0].searchCost).toBeCloseTo(0.01, 10);
    expect(result.costs[0].totalCost).toBeCloseTo(expected.totalCost, 10);
  });

  it("accepts a real link the model says it read off an opened page, not only image-search hits", async () => {
    stubFetch(
      openAiBody({
        images: [
          {
            url: "https://toys4less.com/cdn/shop/files/tank.jpg",
            confidence: "medium",
            matchedOn: "read directly off the confirmed product page",
          },
        ],
        notes: "Confirmed the SKU on the product page and read its photo directly.",
      })
    );
    const result = await enrichRow(params);
    const images = result.data.imageUrls as Array<{ imageUrl: string }>;
    expect(images).toHaveLength(1);
    expect(images[0]!.imageUrl).toBe("https://toys4less.com/cdn/shop/files/tank.jpg");
  });

  it("drops a reported link that does not actually load as an image, even at high confidence", async () => {
    verifyMock = imageVerificationMock({
      "https://cdn.example.com/dead.jpg": { status: 404 },
    });
    stubFetch(
      openAiBody({
        images: [{ url: "https://cdn.example.com/dead.jpg", confidence: "high", matchedOn: "brand+model" }],
        notes: "",
      })
    );
    const result = await enrichRow(params);
    expect(result.data).toEqual({ imageUrls: [], [notFoundKey]: "" });
  });

  it("drops a link that loads but is not actually an image", async () => {
    verifyMock = imageVerificationMock({
      "https://example.com/page.html": { contentType: "text/html" },
    });
    stubFetch(
      openAiBody({
        images: [{ url: "https://example.com/page.html", confidence: "high", matchedOn: "brand+model" }],
        notes: "",
      })
    );
    const result = await enrichRow(params);
    expect(result.data).toEqual({ imageUrls: [], [notFoundKey]: "" });
  });

  it("annotates but never drops a low- or medium-confidence match that does verify", async () => {
    stubFetch(
      openAiBody({
        images: [
          { url: "https://cdn.example.com/a.jpg", confidence: "medium", matchedOn: "brand+model only" },
          { url: "https://cdn.example.com/b.jpg", confidence: "low", matchedOn: "title match only" },
        ],
        notes: "Two uncertain matches, both included.",
      })
    );
    const result = await enrichRow(params);
    const images = result.data.imageUrls as Array<{ imageUrl: string; title: string }>;
    expect(images).toHaveLength(2);
    expect(images[0]!.title).toBe("medium confidence — matched on brand+model only. Product image");
    expect(images[1]!.title).toBe("low confidence — matched on title match only. Product image");
  });

  it("uses high effort and search context on Premium", async () => {
    stubFetch(openAiBody({ images: [], notes: "" }));
    await enrichRow({ ...params, settings: { enrichmentModel: "premium", outputLanguage: "English" } });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.model).toBe("gpt-6-sol");
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.tools[0].search_context_size).toBe("high");
  });

  it("reports the cost of a billed but unusable response", async () => {
    stubFetch(openAiBody({}, "incomplete"));
    const error = await enrichRow(params).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EnrichBilledAttemptError);
    expect((error as EnrichBilledAttemptError).costs).toHaveLength(1);
  });

  it("sends website rules as web_search filters and enforces them on results", async () => {
    stubFetch(
      openAiBody({
        images: [
          { url: "https://cdn.example.com/a.jpg", confidence: "high", matchedOn: "brand+model" },
          { url: "https://cdn.example.com/b.jpg", confidence: "high", matchedOn: "brand+model" },
        ],
        notes: "",
      })
    );
    const result = await enrichRow({
      ...params,
      enrichmentColumns: [
        {
          ...params.enrichmentColumns[0],
          allowedDomains: ["https://www.Example.com/shop", "example.com"],
          blockedDomains: ["pinterest.com", "not a site"],
        },
      ],
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.tools[0].filters).toEqual({
      allowed_domains: ["example.com"],
      blocked_domains: ["pinterest.com"],
    });
    const prompt = request.input[0].content.at(-1).text as string;
    expect(prompt).toContain("## Website rules (enforced)");
    // Both results are on example.com, so both pass domain rules and verify.
    expect((result.data.imageUrls as unknown[]).length).toBe(2);
  });

  it("drops results outside the allowed websites even if the model picked them", async () => {
    stubFetch(
      openAiBody({
        images: [{ url: "https://cdn.example.com/a.jpg", confidence: "high", matchedOn: "brand+model" }],
        notes: "",
      })
    );
    const result = await enrichRow({
      ...params,
      enrichmentColumns: [{ ...params.enrichmentColumns[0], allowedDomains: ["lego.com"] }],
    });
    expect(result.data).toEqual({ imageUrls: [], [notFoundKey]: "" });
  });

  it("checks website rules against the page the image came from, so store CDN images are kept", async () => {
    stubFetch(
      openAiBody({
        images: [
          {
            url: "https://cdn.shopify.com/s/files/1/tank.jpg",
            pageUrl: "https://toys4less.com/products/electric-ride-on-toy-tank.json",
            confidence: "high",
            matchedOn: "SKU on product page",
          },
          {
            url: "https://cdn.shopify.com/s/files/1/other.jpg",
            pageUrl: "https://elsewhere.com/products/other",
            confidence: "high",
            matchedOn: "brand+model",
          },
        ],
        notes: "",
      })
    );
    const result = await enrichRow({
      ...params,
      enrichmentColumns: [{ ...params.enrichmentColumns[0], allowedDomains: ["toys4less.com"] }],
    });
    expect(result.data.imageUrls).toEqual([
      expect.objectContaining({
        imageUrl: "https://cdn.shopify.com/s/files/1/tank.jpg",
        pageUrl: "https://toys4less.com/products/electric-ride-on-toy-tank",
      }),
    ]);
  });

  it("looks the row's code up on allowed stores and hands exact matches to the model", async () => {
    const fetchMock = vi.fn((input: string, init: { method?: string; body?: string }) => {
      if (input === OPENAI_RESPONSES_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              openAiBody({
                images: [
                  {
                    url: "https://cdn.shopify.com/s/files/1/dozer-1.jpg",
                    pageUrl: "https://toys4less.com/products/electric-ride-on-bulldozer",
                    confidence: "high",
                    matchedOn: "store catalog SKU match",
                  },
                ],
                notes: "",
              })
            ),
            { status: 200 }
          )
        );
      }
      if (input.startsWith("https://toys4less.com/search/suggest.json")) {
        return Promise.resolve(
          Response.json({ resources: { results: { products: [{ handle: "electric-ride-on-bulldozer" }] } } })
        );
      }
      if (input === "https://toys4less.com/products/electric-ride-on-bulldozer.json") {
        return Promise.resolve(
          Response.json({
            product: {
              title: "Electric Ride-On Bulldozer",
              vendor: "Paktat",
              variants: [{ sku: "RCP1151426", barcode: "3000000071502" }],
              images: [{ src: "https://cdn.shopify.com/s/files/1/dozer-1.jpg" }],
            },
          })
        );
      }
      return verifyMock(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichRow({
      ...params,
      productData: { Code: "RCP1151426", Description: "2.4G RC ENGINEERING VEHICLE (YELLOW)" },
      enrichmentColumns: [{ ...params.enrichmentColumns[0], allowedDomains: ["toys4less.com"] }],
    });

    const openAiCall = fetchMock.mock.calls.find((c) => c[0] === OPENAI_RESPONSES_URL)!;
    const prompt = JSON.parse(openAiCall[1].body as string).input[0].content.at(-1).text as string;
    expect(prompt).toContain("## Store catalog matches");
    expect(prompt).toContain("- Electric Ride-On Bulldozer — https://toys4less.com/products/electric-ride-on-bulldozer");
    expect(prompt).toContain("  - https://cdn.shopify.com/s/files/1/dozer-1.jpg");
    expect((result.data.imageUrls as unknown[]).length).toBe(1);
  });

  it("retries without filters when OpenAI rejects them, still enforcing the rules", async () => {
    let openAiCallCount = 0;
    const fetchMock = vi.fn((input: string, init: { method?: string; body?: string }) => {
      if (input === OPENAI_RESPONSES_URL) {
        openAiCallCount += 1;
        if (openAiCallCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: { message: "Unsupported parameter: 'filters' with image search" } }),
              { status: 400 }
            )
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify(
              openAiBody({
                images: [{ url: "https://cdn.example.com/a.jpg", confidence: "high", matchedOn: "brand+model" }],
                notes: "",
              })
            ),
            { status: 200 }
          )
        );
      }
      return verifyMock(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichRow({
      ...params,
      enrichmentColumns: [{ ...params.enrichmentColumns[0], blockedDomains: ["example.com"] }],
    });
    const openAiCalls = fetchMock.mock.calls.filter((c) => c[0] === OPENAI_RESPONSES_URL);
    expect(openAiCalls).toHaveLength(2);
    const retry = JSON.parse(openAiCalls[1]![1].body as string);
    expect(retry.tools[0].filters).toBeUndefined();
    expect(result.data).toEqual({ imageUrls: [], [notFoundKey]: "" });
    // The rejected request carried no usage, so only the retry is billed.
    expect(result.costs).toHaveLength(1);
  });

  it("records the model's own reason when it finds nothing", async () => {
    stubFetch(
      openAiBody({ images: [], notes: "SKU pointed to a different product; no confident match." })
    );
    const result = await enrichRow(params);
    expect(result.data).toEqual({
      imageUrls: [],
      [notFoundKey]: "SKU pointed to a different product; no confident match.",
    });
  });

  it("clears the not-found reason once a run finds real images", async () => {
    stubFetch(
      openAiBody({
        images: [{ url: "https://cdn.example.com/a.jpg", confidence: "high", matchedOn: "brand+model" }],
        notes: "Confident match",
      })
    );
    const result = await enrichRow(params);
    // A prior empty run may have left a stale reason on this row; a successful
    // run must always overwrite it with an empty string, never leave it stale.
    expect(result.data[notFoundKey]).toBe("");
  });

  it("leaves mixed column runs on the generic enrichment prompt", async () => {
    stubFetch(
      openAiBody({ imageUrls: [], enhancedTitle: "Widget", notes: "" })
    );
    await enrichRow({ ...params, enabledColumns: ["imageUrls", "enhancedTitle"] });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.instructions).toBeUndefined();
    expect(request.text.format.name).not.toBe("catalog_image_finder");
  });
});
