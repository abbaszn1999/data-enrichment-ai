import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost } from "@/lib/ai-pricing";
import { enrichRow } from "../agent";
import { EnrichBilledAttemptError } from "../openai";
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
      {
        type: "web_search_call",
        action: { type: "search", query: "Widget WX-1" },
        results: [
          { type: "image_result", image_url: "https://cdn.example.com/a.jpg", source_website_url: "https://example.com/a" },
          { type: "image_result", image_url: "https://cdn.example.com/b.jpg", source_website_url: "https://example.com/b" },
        ],
      },
      { type: "web_search_call", action: { type: "open_page" } },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(selection) }],
      },
    ],
  };
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
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends the skill, structured brief and gpt-6-sol, and bills only search actions", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          openAiBody({
            imageUrls: ["https://cdn.example.com/b.jpg", "https://example.com/a"],
            notes: "Confident match",
          })
        ),
        { status: 200 }
      )
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
      // Over-fetches well beyond the requested 2, so the model has real
      // candidates to choose from instead of being handed exactly the target.
      image_settings: { max_results: 20, caption: true },
    });
    expect(request.text.format.name).toBe("catalog_image_finder");
    // The output cap still matches what was actually requested, not the
    // wider search pool above.
    expect(request.text.format.schema.properties.imageUrls.maxItems).toBe(2);
    const prompt = request.input[0].content.at(-1).text as string;
    expect(prompt).toContain('- Brand (column "Brand"): Acme');
    expect(prompt).toContain(
      "## Custom instruction (store owner, highest priority)\nFront view first"
    );
    expect(request.tools[0].filters).toBeUndefined();

    // Only the approved, exact image_url survives; no padding with "a.jpg".
    expect(result.data).toEqual({
      imageUrls: [
        expect.objectContaining({ imageUrl: "https://cdn.example.com/b.jpg" }),
      ],
      [notFoundKey]: "",
    });
    expect(result.costs).toHaveLength(1);
    const expected = calculateOpenAiWebSearchCost("gpt-6-sol", usage, 1);
    expect(result.costs[0].searchCost).toBeCloseTo(0.01, 10);
    expect(result.costs[0].totalCost).toBeCloseTo(expected.totalCost, 10);
  });

  it("uses high effort and search context on Premium", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(openAiBody({ imageUrls: [], notes: "" })), { status: 200 })
    );
    await enrichRow({ ...params, settings: { enrichmentModel: "premium", outputLanguage: "English" } });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.model).toBe("gpt-6-sol");
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.tools[0].search_context_size).toBe("high");
  });

  it("reports the cost of a billed but unusable response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(openAiBody({}, "incomplete")), { status: 200 })
    );
    const error = await enrichRow(params).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EnrichBilledAttemptError);
    expect((error as EnrichBilledAttemptError).costs).toHaveLength(1);
  });

  it("sends website rules as web_search filters and enforces them on results", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          openAiBody({
            imageUrls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
            notes: "",
          })
        ),
        { status: 200 }
      )
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

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.tools[0].filters).toEqual({
      allowed_domains: ["example.com"],
      blocked_domains: ["pinterest.com"],
    });
    const prompt = request.input[0].content.at(-1).text as string;
    expect(prompt).toContain("## Website rules (enforced)");
    // Both results come from example.com pages, so both pass.
    expect((result.data.imageUrls as unknown[]).length).toBe(2);
  });

  it("drops results outside the allowed websites even if the model picked them", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          openAiBody({ imageUrls: ["https://cdn.example.com/a.jpg"], notes: "" })
        ),
        { status: 200 }
      )
    );
    const result = await enrichRow({
      ...params,
      enrichmentColumns: [{ ...params.enrichmentColumns[0], allowedDomains: ["lego.com"] }],
    });
    expect(result.data).toEqual({ imageUrls: [], [notFoundKey]: "" });
  });

  it("retries without filters when OpenAI rejects them, still enforcing the rules", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Unsupported parameter: 'filters' with image search" } }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            openAiBody({ imageUrls: ["https://cdn.example.com/a.jpg"], notes: "" })
          ),
          { status: 200 }
        )
      );
    const result = await enrichRow({
      ...params,
      enrichmentColumns: [{ ...params.enrichmentColumns[0], blockedDomains: ["example.com"] }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(retry.tools[0].filters).toBeUndefined();
    expect(result.data).toEqual({ imageUrls: [], [notFoundKey]: "" });
    // The rejected request carried no usage, so only the retry is billed.
    expect(result.costs).toHaveLength(1);
  });

  it("records the model's own reason when it finds nothing", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          openAiBody({ imageUrls: [], notes: "SKU pointed to a different product; no confident match." })
        ),
        { status: 200 }
      )
    );
    const result = await enrichRow(params);
    expect(result.data).toEqual({
      imageUrls: [],
      [notFoundKey]: "SKU pointed to a different product; no confident match.",
    });
  });

  it("clears the not-found reason once a run finds real images", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          openAiBody({ imageUrls: ["https://cdn.example.com/a.jpg"], notes: "Confident match" })
        ),
        { status: 200 }
      )
    );
    const result = await enrichRow(params);
    // A prior empty run may have left a stale reason on this row; a successful
    // run must always overwrite it with an empty string, never leave it stale.
    expect(result.data[notFoundKey]).toBe("");
  });

  it("leaves mixed column runs on the generic enrichment prompt", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(openAiBody({ imageUrls: [], enhancedTitle: "Widget", notes: "" })),
        { status: 200 }
      )
    );
    await enrichRow({ ...params, enabledColumns: ["imageUrls", "enhancedTitle"] });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.instructions).toBeUndefined();
    expect(request.text.format.name).not.toBe("catalog_image_finder");
  });
});
