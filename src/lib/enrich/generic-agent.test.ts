import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost } from "@/lib/ai-pricing";
import { getDefaultEnrichmentColumns } from "@/types";

const { enrichRow } = await import("./agent");
const { OPENAI_RESPONSES_URL, isEnrichOutputTruncatedError, billedCostsOf } = await import("./openai");
const { titleTagSpec } = await import("./columns/product/title-tag");
const { productSpecificationsSpec } = await import("./columns/product/product-specifications");
const { enrichedValueToText } = await import("@/lib/export-values");
const { genericTextSpec } = await import("./columns/shared/text");
const { buildEnrichedData } = await import("./parse");
const { looksLikeHtml } = await import("@/lib/html-detect");

const usage = { input_tokens: 4_000, input_tokens_details: { cached_tokens: 1_000 }, output_tokens: 9_000 };

const defaultColumns = getDefaultEnrichmentColumns("product");

// The four writing columns, switched on. Source URLs is answered by Google AI
// Mode, not by this OpenAI call, so it is covered in source-urls/source-urls.test.ts.
const columns = defaultColumns
  .filter((c) => c.id !== "sourceUrls" && c.type !== "categories" && c.type !== "imageUrls" && c.id !== "imageSourceUrls")
  .map((c) => ({
    ...c,
    enabled: true,
    customInstruction: c.id === "titleTag" ? "Always end with the brand" : undefined,
  }));

const params = {
  productData: { Title: "Widget WX-1", Brand: "Acme" },
  enabledColumns: columns.map((c) => c.id),
  enrichmentColumns: columns,
  settings: { enrichmentModel: "standard" as const, outputLanguage: "English" },
  kind: "product" as const,
};

function stubOpenAi(body: unknown) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    void init; // typed so tests can read the request body from mock.calls
    if (String(input) === OPENAI_RESPONSES_URL) return new Response(JSON.stringify(body), { status: 200 });
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof stubOpenAi>) =>
  JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Enrich default columns", () => {
  it("are Title tag, Product description, Product specifications, FAQ section and Source URLs", () => {
    expect(defaultColumns.slice(0, 5).map((c) => c.label)).toEqual([
      "Title tag",
      "Product description",
      "Product specifications",
      "FAQ section",
      "Source URLs",
    ]);
  });

  it("start switched off; Source URLs runs from the Source & Image Finder tab", () => {
    expect(defaultColumns.filter((c) => c.enabled).map((c) => c.id)).toEqual([]);
  });

  it("each of the five ships with a starting custom instruction the user can read and edit", () => {
    for (const column of defaultColumns.slice(0, 5)) {
      expect(column.customInstruction?.trim().length, column.label).toBeGreaterThan(20);
    }
  });
});

describe("Enrich generic agent request", () => {
  it("is one fixed agent: gpt-6.1-sol medium, web search required, 128k output, instructions + row input", async () => {
    const fetchMock = stubOpenAi({
      id: "r1",
      status: "completed",
      usage,
      output: [
        { type: "web_search_call", action: { type: "search", query: "Widget WX-1" } },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                titleTag: "Widget WX-1 by Acme",
                marketingDescription: "A fine widget.",
                productSpecifications: ["Color: Red"],
                faq: [{ question: "Q?", answer: "A." }],
                notes: "",
              }),
            },
          ],
        },
      ],
    });
    // The stored tier no longer matters: premium must send the same request.
    await enrichRow({ ...params, settings: { enrichmentModel: "premium", outputLanguage: "English" } });
    const body = sent(fetchMock);
    expect(body.model).toBe("gpt-6.1-sol");
    expect(body.reasoning.effort).toBe("medium");
    expect(body.max_output_tokens).toBe(128_000);
    expect(body.tool_choice).toBe("required");
    expect(body.tools.some((t: { type: string }) => t.type === "web_search")).toBe(true);
    expect(body.instructions).toContain("Columns to fill (4):");
    expect(body.instructions).toContain("Always end with the brand");
    expect(JSON.stringify(body.input)).toContain("Widget WX-1");
    expect(body.instructions).not.toContain("Widget WX-1");
  });

  it("charges exact tokens and web searches from the response", async () => {
    stubOpenAi({
      id: "r1",
      status: "completed",
      usage,
      output: [
        { type: "web_search_call", action: { type: "search", query: "a" } },
        { type: "web_search_call", action: { type: "search", query: "b" } },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                titleTag: "T",
                marketingDescription: "D",
                productSpecifications: [],
                faq: [],
                notes: "",
              }),
            },
          ],
        },
      ],
    });
    const result = await enrichRow(params);
    const expected = calculateOpenAiWebSearchCost("gpt-6.1-sol", usage, 2);
    expect(result.costs).toHaveLength(1);
    expect(result.costs[0].totalCost).toBeCloseTo(expected.totalCost, 10);
  });

  it("reports an output-limit stop as a billed, non-retryable error", async () => {
    stubOpenAi({
      id: "r1",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage,
      output: [{ type: "web_search_call", action: { type: "search", query: "a" } }],
    });
    const error = await enrichRow(params).catch((e: unknown) => e);
    expect(isEnrichOutputTruncatedError(error)).toBe(true);
    const billed = billedCostsOf(error);
    expect(billed).toHaveLength(1);
    expect(billed[0].totalCost).toBeCloseTo(calculateOpenAiWebSearchCost("gpt-6.1-sol", usage, 1).totalCost, 10);
    expect((error as Error).message).toContain("Select fewer columns");
  });
});

describe("Enrich column parsing", () => {
  const ctx = (extra: Record<string, unknown> = {}) =>
    ({
      kind: "product",
      language: "English",
      col: { id: "x", label: "X", description: "", type: "text", enabled: true },
      hasStoreAllowlist: false,
      ...extra,
    }) as never;

  it("keeps a title tag inside the search-engine limit", () => {
    const long = "Widget ".repeat(30);
    const parsed = titleTagSpec.parseValue(long, ctx()) as string;
    expect(parsed.length).toBeLessThanOrEqual(70);
  });

  it("lets the owner's own longer title length through, and keeps the limit for the shipped instruction", () => {
    const long = "Widget ".repeat(30).trim();
    const withInstruction = (customInstruction: string) =>
      ({
        kind: "product",
        language: "English",
        col: { id: "titleTag", label: "Title tag", description: "", type: "text", enabled: true, customInstruction },
        hasStoreAllowlist: false,
      }) as never;

    const shipped = titleTagSpec.parseValue(long, withInstruction("Write a clear SEO title of 50-60 characters.")) as string;
    expect(shipped.length).toBeLessThanOrEqual(70);

    const owner = titleTagSpec.parseValue(long, withInstruction("Titles of 90-100 characters, brand last.")) as string;
    expect(owner.length).toBeGreaterThan(70);
    expect(owner.length).toBeLessThanOrEqual(100);

    const section = titleTagSpec.buildPromptSection(withInstruction("Titles of 90-100 characters, brand last.")) as string;
    expect(section).not.toContain("never more than 70");
    expect(titleTagSpec.buildPromptSection(withInstruction("Brand last.")) as string).toContain("never more than 70");
  });

  it("normalises specifications to one entry each, removes repeats and keeps every written entry", () => {
    const parsed = productSpecificationsSpec.parseValue(
      ["Color: Red", "color: red", "Waterproof", { attribute: "Weight", value: "2 kg" }],
      ctx()
    ) as string[];
    expect(parsed).toContain("Color: Red");
    expect(parsed).toContain("Waterproof");
    expect(parsed).toContain("Weight: 2 kg");
    expect(parsed.filter((p) => p.toLowerCase() === "color: red")).toHaveLength(1);
  });

  const SPEC_TABLE =
    '<table class="product-specifications"><caption>Product Specifications</caption><tbody><tr><th scope="row">Brand</th><td>PAKTAT</td></tr></tbody></table>';

  it("keeps an HTML specifications table (it has no colon) as one string the sheet can preview", () => {
    const parsed = productSpecificationsSpec.parseValue([SPEC_TABLE], ctx());
    expect(parsed).toBe(SPEC_TABLE);
    expect(looksLikeHtml(parsed as string)).toBe(true);
  });

  it("a custom list column answered with HTML is stored as one HTML string too", () => {
    const custom = ctx({ col: { id: "custom_1", label: "Specs", description: "", type: "list", enabled: true } });
    expect(genericTextSpec.parseValue([SPEC_TABLE], custom)).toBe(SPEC_TABLE);
    expect(genericTextSpec.parseValue(["a", "b"], custom)).toEqual(["a", "b"]);
  });

  it("never leaves an answered free-form column empty (the parser's result is replaced by the answer as written)", () => {
    const data = buildEnrichedData({
      selection: { productSpecifications: [SPEC_TABLE], titleTag: "Widget", marketingDescription: { text: "odd shape" } },
      response: { output: [] } as never,
      enabledColumns: ["productSpecifications", "titleTag", "marketingDescription"],
      kind: "product",
    });
    expect(data.productSpecifications).toBe(SPEC_TABLE);
    expect(data.titleTag).toBe("Widget");
    expect(String(data.marketingDescription)).toContain("odd shape");
  });

  it("exports specifications one 'Attribute: Value' per line", () => {
    expect(enrichedValueToText(["Color: Red", "Weight: 2 kg"], "productSpecifications")).toBe("Color: Red\nWeight: 2 kg");
  });
});
