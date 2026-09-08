import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichProductRow } from "./agent";

const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.OPENAI_API_KEY = originalKey;
});

describe("enrichProductRow OpenAI agent", () => {
  it("sends one Responses request with Standard/Terra and text web_search", async () => {
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
                    enhancedTitle: "Acme Widget Pro 500",
                    notes: "confident from row data",
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 800, output_tokens: 120 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichProductRow(
      { Title: "Acme Widget Pro 500", Brand: "Acme", SKU: "AW-500" },
      ["enhancedTitle"],
      [
        {
          id: "enhancedTitle",
          label: "Enhanced Title",
          description: "SEO title",
          type: "text",
          enabled: true,
        },
      ],
      { enrichmentModel: "standard", outputLanguage: "English" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/v1/responses");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.reasoning.effort).toBe("medium");
    expect(body.tool_choice).toBe("auto");
    expect(body.tools[0].type).toBe("web_search");
    expect(body.tools[0].search_content_types).toEqual(["text"]);
    expect(body.text.format.type).toBe("json_schema");
    expect(result.data.enhancedTitle).toBe("Acme Widget Pro 500");
    expect(result.costs).toHaveLength(1);
  });

  it("requires image web search for imageUrls on Premium/Sol", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const imageUrl = "https://cdn.example/exact.jpg";
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
                  image_url: imageUrl,
                  source_website_url: "https://brand.example/p",
                  caption: "Exact",
                },
              ],
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    imageUrls: [imageUrl],
                    notes: "searched images",
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 1200, output_tokens: 80 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichProductRow(
      { Title: "Acme Widget", Brand: "Acme" },
      ["imageUrls"],
      [
        {
          id: "imageUrls",
          label: "Images",
          description: "Find images",
          type: "imageUrls",
          enabled: true,
          imageCount: 2,
        },
      ],
      { enrichmentModel: "premium", outputLanguage: "English" }
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning.effort).toBe("high");
    expect(body.tool_choice).toBe("required");
    expect(body.tools[0].search_content_types).toEqual(["image", "text"]);
    expect(body.tools[0].image_settings.max_results).toBe(2);
    expect(body.include).toContain("web_search_call.results");
    expect((result.data.imageUrls as { imageUrl: string }[])[0].imageUrl).toBe(
      imageUrl
    );
  });

  it("retries without source input_image when OpenAI cannot download it", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const deadImage = "https://cdn.example/mh01-gray.jpg";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "Error while downloading file. Upstream status code: 404.",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
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
                      enhancedTitle: "Chaz Kangeroo Hoodie",
                      notes: "continued without source photo",
                    }),
                  },
                ],
              },
            ],
            usage: { input_tokens: 900, output_tokens: 80 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichProductRow(
      {
        Title: "Chaz Kangeroo Hoodie",
        SKU: "MH01",
        Images: deadImage,
      },
      ["enhancedTitle"],
      [
        {
          id: "enhancedTitle",
          label: "Enhanced Title",
          description: "SEO title",
          type: "text",
          enabled: true,
        },
      ],
      { enrichmentModel: "standard", outputLanguage: "English" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    const second = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    expect(
      first.input[0].content.some(
        (part: { type?: string; image_url?: string }) =>
          part.type === "input_image" && part.image_url === deadImage
      )
    ).toBe(true);
    expect(
      second.input[0].content.some(
        (part: { type?: string }) => part.type === "input_image"
      )
    ).toBe(false);
    expect(result.data.enhancedTitle).toBe("Chaz Kangeroo Hoodie");
  });

  it("does not retry source-image stripping for unrelated OpenAI errors", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "OpenAI enrich failed (429)" },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      enrichProductRow(
        {
          Title: "Chaz Kangeroo Hoodie",
          Images: "https://cdn.example/mh01-gray.jpg",
        },
        ["enhancedTitle"],
        [
          {
            id: "enhancedTitle",
            label: "Enhanced Title",
            description: "SEO title",
            type: "text",
            enabled: true,
          },
        ],
        { enrichmentModel: "standard", outputLanguage: "English" }
      )
    ).rejects.toThrow("OpenAI enrich failed (429)");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
