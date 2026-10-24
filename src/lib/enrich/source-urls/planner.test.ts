import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costToCredits, sumCosts } from "@/lib/ai-pricing";
import { OPENAI_RESPONSES_URL } from "../openai";
import { planSourceUrls } from "./planner";
import { buildSourceUrlsPlannerBrief, SOURCE_URLS_PLANNER_INSTRUCTIONS } from "./planner-skill";

const usage = { input_tokens: 3_000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 800 };

const completed = (payload: unknown) => ({
  id: "r1",
  status: "completed",
  usage,
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
});

const goodPlan = {
  steps: [
    { name: "Barcode first", text: "Find the product page that sells the product with barcode {{Barcode}}." },
    { name: "SKU on shops", text: "On shop-a.com and shop-b.com find the page for SKU {{Vendor SKU}}; a SKU differing only in the last letter counts." },
  ],
  notes: "Barcode, then SKU on the named shops.",
};

const input = {
  instruction: "Search by barcode first, then by vendor SKU on shop-a.com and shop-b.com.",
  columns: [
    { name: "Barcode", samples: ["5063229294815"] },
    { name: "Vendor SKU", samples: ["S07FN6DB5"] },
  ],
  hasPhoto: true,
};

describe("planSourceUrls", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const stub = (...responses: Array<{ status?: number; body: unknown } | Error>) => {
    let call = 0;
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => {
      const next = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("makes one GPT-6.1 Sol call with no web search and returns the validated steps", async () => {
    const fetchMock = stub({ body: completed(goodPlan) });
    const { plan, costs } = await planSourceUrls(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(OPENAI_RESPONSES_URL);
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(request.model).toBe("gpt-6.1-sol");
    expect(request.tools).toEqual([]);
    expect(request.tool_choice).toBeUndefined();
    expect(request.instructions).toBe(SOURCE_URLS_PLANNER_INSTRUCTIONS);
    expect(request.text.format).toMatchObject({ type: "json_schema", name: "source_urls_plan", strict: true });

    expect(plan).toMatchObject({ version: 1, source: "planner", columns: ["Barcode", "Vendor SKU"], model: "gpt-6.1-sol" });
    expect(plan.steps.map((s) => s.name)).toEqual(["Barcode first", "SKU on shops"]);
    expect(plan.notes).toBe("Barcode, then SKU on the named shops.");
    expect(plan.billing).toBeUndefined();
    // One billed round, priced from the response's usage, no search charge.
    expect(costs).toHaveLength(1);
    expect(costs[0]!.model).toBe("gpt-6.1-sol");
    expect(costs[0]!.searchCost).toBe(0);
    expect(costs[0]!.usage.promptTokens).toBe(3_000);
    expect(costs[0]!.totalCost).toBeCloseTo((3_000 / 1e6) * 2 + (800 / 1e6) * 10, 10);
  });

  it("sends the owner's instruction and the sample values, never a row", async () => {
    const fetchMock = stub({ body: completed(goodPlan) });
    await planSourceUrls(input);
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    const text = request.input[0].content.at(-1).text as string;
    expect(text).toContain("- Barcode: for example \"5063229294815\"");
    expect(text).toContain("- Vendor SKU: for example \"S07FN6DB5\"");
    expect(text).toContain(input.instruction);
    expect(text).toContain("A photo of the product is attached to every search");
  });

  it("makes no call and bills nothing without an instruction or without columns", async () => {
    const fetchMock = stub({ body: completed(goodPlan) });
    expect((await planSourceUrls({ ...input, instruction: "   " })).plan.source).toBe("default");
    expect((await planSourceUrls({ ...input, columns: [] })).plan.source).toBe("default");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a request that names an unknown column but keeps the good ones", async () => {
    stub({
      body: completed({
        steps: [...goodPlan.steps, { name: "Made up", text: "Find the product page for EAN {{EAN}} on any site." }],
        notes: "",
      }),
    });
    const { plan } = await planSourceUrls(input);
    expect(plan.steps).toHaveLength(2);
  });

  it("tries once more after an unusable answer and bills BOTH calls", async () => {
    const bad = completed({ steps: [{ name: "x", text: "Find every page you can for this item, please." }], notes: "" });
    const fetchMock = stub({ body: bad }, { body: completed(goodPlan) });
    const { plan, costs } = await planSourceUrls(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan.source).toBe("planner");
    expect(costs).toHaveLength(2);
    // The retry tells the planner what was wrong with the first answer.
    const retryRequest = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(retryRequest.input[0].content.at(-1).text).toContain("Your previous answer could not be used");
    const totals = sumCosts(costs);
    expect(totals.totalCredits).toBe(costToCredits(2 * costs[0]!.totalCost));
  });

  it("falls back to the default plan after two unusable answers, still billing both", async () => {
    const bad = completed({ steps: [], notes: "" });
    const fetchMock = stub({ body: bad });
    const { plan, costs } = await planSourceUrls(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan.source).toBe("default");
    expect(plan.steps).toEqual([]);
    expect(plan.reason).toMatch(/no usable search requests/);
    expect(costs).toHaveLength(2);
  });

  it("falls back to the default plan, billing nothing, when OpenAI never answers", async () => {
    stub(new Error("network down"));
    const { plan, costs } = await planSourceUrls(input);
    expect(plan.source).toBe("default");
    expect(costs).toEqual([]);
  });

  it("does not try again when the AI account is out of quota, but bills what was billed", async () => {
    const fetchMock = stub({
      status: 429,
      body: { id: "r1", status: "failed", usage, error: { code: "insufficient_quota", message: "You exceeded your current quota" } },
    });
    const { plan, costs } = await planSourceUrls(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan.source).toBe("default");
    expect(costs).toHaveLength(1);
  });

  it("never throws, whatever the answer is", async () => {
    stub({ body: { not: "a response" } });
    await expect(planSourceUrls(input)).resolves.toMatchObject({ plan: { source: "default" } });
  });
});

describe("planner brief and skill", () => {
  it("lists every column with its samples and the owner's words", () => {
    const brief = buildSourceUrlsPlannerBrief({ columns: input.columns, hasPhoto: false, instruction: "my words" });
    expect(brief).toContain("- Barcode: for example");
    expect(brief).toContain("No photo is attached.");
    expect(brief).toContain("my words");
    expect(brief).not.toContain("previous answer");
  });

  it("tells the planner the rules that keep the plan useful", () => {
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/placeholder written as \{\{Column name\}\}/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/differ by what they search with/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/Do not mention: JSON/);
  });
});
