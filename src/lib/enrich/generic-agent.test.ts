import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost } from "@/lib/ai-pricing";
import { getDefaultEnrichmentColumns } from "@/types";

const { enrichRow } = await import("./agent");
const { OPENAI_RESPONSES_URL, isEnrichOutputTruncatedError, billedCostsOf } = await import("./openai");
const { titleTagSpec } = await import("./columns/product/title-tag");
const { productSpecificationsSpec } = await import("./columns/product/product-specifications");
const { enrichedValueToText } = await import("@/lib/export-values");

const usage = { input_tokens: 4_000, input_tokens_details: { cached_tokens: 1_000 }, output_tokens: 9_000 };

const columns = getDefaultEnrichmentColumns("product")
  .filter((c) => c.enabled)
  .map((c) => ({ ...c, customInstruction: c.id === "titleTag" ? "Always end with the brand" : undefined }));

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
  it("are exactly Title tag, Product description, Product specifications and FAQ section", () => {
    expect(columns.map((c) => c.label)).toEqual(["Title tag", "Product description", "Product specifications", "FAQ section"]);
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

  it("normalises specifications to one 'Attribute: Value' per entry and drops the rest", () => {
    const parsed = productSpecificationsSpec.parseValue(
      ["Color: Red", "color: red", "no separator here", { attribute: "Weight", value: "2 kg" }],
      ctx()
    ) as string[];
    expect(parsed).toContain("Color: Red");
    expect(parsed).not.toContain("no separator here");
    expect(parsed.filter((p) => p.toLowerCase() === "color: red")).toHaveLength(1);
  });

  it("exports specifications one 'Attribute: Value' per line", () => {
    expect(enrichedValueToText(["Color: Red", "Weight: 2 kg"], "productSpecifications")).toBe("Color: Red\nWeight: 2 kg");
  });
});
