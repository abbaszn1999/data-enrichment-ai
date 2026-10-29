import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costToCredits, sumCosts } from "@/lib/ai-pricing";
import { OPENAI_RESPONSES_URL } from "../openai";
import { planSourceUrls } from "./planner";
import { buildSourceUrlsPlannerBrief, buildSourceUrlsPlannerSchema, SOURCE_URLS_PLANNER_INSTRUCTIONS } from "./planner-skill";

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
    { name: "Any seller", text: "Find every seller of the product with barcode {{Barcode}} or SKU {{Vendor SKU}}, in any country." },
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
    expect(plan.steps.map((s) => s.name)).toEqual(["Barcode first", "SKU on shops", "Any seller"]);
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

  it("makes no call and bills nothing without columns, or with one column and no instruction", async () => {
    const fetchMock = stub({ body: completed(goodPlan) });
    expect((await planSourceUrls({ ...input, columns: [] })).plan.source).toBe("default");
    expect((await planSourceUrls({ ...input, instruction: "", columns: [] })).plan.source).toBe("default");
    const single = await planSourceUrls({ ...input, instruction: "   ", columns: [input.columns[0]!] });
    expect(single.plan.source).toBe("default");
    expect(single.costs).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("plans from the columns alone when the owner wrote no instruction, billing that call", async () => {
    const fetchMock = stub({ body: completed(goodPlan) });
    const { plan, costs } = await planSourceUrls({ ...input, instruction: "  " });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan.source).toBe("planner");
    expect(costs).toHaveLength(1);
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    const text = request.input[0].content.at(-1).text as string;
    expect(text).toContain("the owner gave no instruction");
    expect(text).toContain("- Barcode: for example");
  });

  it("still plans with one column when the owner wrote an instruction", async () => {
    const barcodeOnly = {
      steps: [
        { name: "Barcode first", text: "Find the product page that sells the product with barcode {{Barcode}}." },
        { name: "Barcode shops", text: "On any shop find the page that lists barcode {{Barcode}}." },
        { name: "Barcode anywhere", text: "Find every page that shows the barcode {{Barcode}} in any country." },
      ],
      notes: "",
    };
    const fetchMock = stub({ body: completed(barcodeOnly) });
    await planSourceUrls({ ...input, columns: [input.columns[0]!] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the identity columns the planner chose, in the ticked spelling, and drops the rest", async () => {
    stub({ body: completed({ ...goodPlan, identityColumns: ["vendor sku", "Made up", "Barcode", "BARCODE", 7] }) });
    const { plan } = await planSourceUrls(input);
    expect(plan.identityColumns).toEqual(["Vendor SKU", "Barcode"]);
  });

  it("leaves identityColumns out when the planner chose none, so every ticked column is used", async () => {
    stub({ body: completed({ ...goodPlan, identityColumns: [] }) });
    expect((await planSourceUrls(input)).plan.identityColumns).toBeUndefined();
    stub({ body: completed({ ...goodPlan, identityColumns: ["Nothing ticked"] }) });
    expect((await planSourceUrls(input)).plan.identityColumns).toBeUndefined();
    stub({ body: completed(goodPlan) });
    const { plan } = await planSourceUrls(input);
    expect(plan.source).toBe("planner");
    expect(plan.identityColumns).toBeUndefined();
  });

  it("drops a request that names an unknown column but keeps the good ones", async () => {
    stub({
      body: completed({
        steps: [...goodPlan.steps, { name: "Made up", text: "Find the product page for EAN {{EAN}} on any site." }],
        notes: "",
      }),
    });
    const { plan } = await planSourceUrls(input);
    // The unknown column made the planner try again; the second answer has the same three good steps and the made-up one.
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.some((s) => s.text.includes("{{EAN}}"))).toBe(false);
  });

  it("asks again, naming the unknown column, when a request uses a column that was not ticked", async () => {
    const withMadeUp = completed({ steps: [...goodPlan.steps.slice(0, 2), { name: "Made up", text: "Find the product page for EAN {{EAN}} on any site." }], notes: "" });
    const fetchMock = stub({ body: withMadeUp }, { body: completed(goodPlan) });
    const { plan } = await planSourceUrls(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan.steps.map((s) => s.name)).toEqual(["Barcode first", "SKU on shops", "Any seller"]);
  });

  it("asks again when the answer has fewer than 3 usable requests, and keeps the second answer", async () => {
    const two = completed({ steps: goodPlan.steps.slice(0, 2), notes: "" });
    const fetchMock = stub({ body: two }, { body: completed(goodPlan) });
    const { plan, costs } = await planSourceUrls(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan.steps).toHaveLength(3);
    expect(costs).toHaveLength(2);
    const retryRequest = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(retryRequest.input[0].content.at(-1).text).toMatch(/exactly 3 are needed/);
  });

  it("uses the 1 or 2 requests of the last answer rather than giving up, when the retry still has fewer than 3", async () => {
    const two = completed({ steps: goodPlan.steps.slice(0, 2), notes: "" });
    const fetchMock = stub({ body: two }, { body: two });
    const { plan } = await planSourceUrls(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan.source).toBe("planner");
    expect(plan.steps).toHaveLength(2);
  });

  it("cuts a request longer than 600 characters instead of dropping it", async () => {
    const long = { name: "Long", text: `Find the product page for barcode {{Barcode}}. ${"Check every shop carefully. ".repeat(40)}` };
    stub({ body: completed({ steps: [long, ...goodPlan.steps.slice(0, 2)], notes: "" }) });
    const { plan } = await planSourceUrls(input);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]!.text.length).toBeLessThanOrEqual(600);
  });

  it("saves the websites the owner limited the search to, cleaned, and leaves them out when there are none", async () => {
    stub({ body: completed({ ...goodPlan, onlyWebsites: ["https://www.Toys4Less.com/x", "not a site!", "toys4less.com"] }) });
    expect((await planSourceUrls(input)).plan.onlyWebsites).toEqual(["toys4less.com"]);
    stub({ body: completed({ ...goodPlan, onlyWebsites: [] }) });
    expect((await planSourceUrls(input)).plan.onlyWebsites).toBeUndefined();
    stub({ body: completed(goodPlan) });
    expect((await planSourceUrls(input)).plan.onlyWebsites).toBeUndefined();
  });

  it("saves closestMatch only when the planner says the owner allows a fallback", async () => {
    stub({ body: completed({ ...goodPlan, closestMatch: true }) });
    expect((await planSourceUrls(input)).plan.closestMatch).toBe(true);
    stub({ body: completed({ ...goodPlan, closestMatch: false }) });
    expect((await planSourceUrls(input)).plan.closestMatch).toBeUndefined();
    stub({ body: completed(goodPlan) });
    expect((await planSourceUrls(input)).plan.closestMatch).toBeUndefined();
    stub({ body: completed({ ...goodPlan, closestMatch: "yes" }) });
    expect((await planSourceUrls(input)).plan.closestMatch).toBeUndefined();
  });

  it("tells the planner when a closest match is allowed, and that a plain 'exact' or 'matching' is not one", () => {
    const skill = SOURCE_URLS_PLANNER_INSTRUCTIONS;
    expect(skill).toMatch(/CLOSEST MATCH\. When the owner allows a fallback to the nearest page/);
    expect(skill).toMatch(/set closestMatch to true/);
    expect(skill).toMatch(/Do NOT say that a different colour, size or model does not count/);
    expect(skill).toMatch(/do NOT ask for "the closest code"/);
    expect(skill).toMatch(/a plain "exact", "matching" or "only this item" is not a fallback/);
    // The strict default is still there for owners who say nothing about variants.
    expect(skill).toMatch(/If the owner said nothing about variants, say in every request that it must be this exact product/);
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

  it("says so when there is no instruction, and quotes one when there is", () => {
    const none = buildSourceUrlsPlannerBrief({ columns: input.columns, hasPhoto: false, instruction: " " });
    expect(none).toContain("the owner gave no instruction");
    expect(none).not.toContain('"""');
    const given = buildSourceUrlsPlannerBrief({ columns: input.columns, hasPhoto: false, instruction: "my words" });
    expect(given).toContain('"""\nmy words\n"""');
    expect(given).not.toContain("the owner gave no instruction");
  });

  it("tells the planner to order the searches itself and never to add a page count on its own", () => {
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/gave no instruction at all, decide the angles yourself from the columns/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/ONLY when the owner asked for a specific number/);
  });

  it("lets the owner's 'exact code only' beat the default cautions, and keeps requests to plain web search", () => {
    const skill = SOURCE_URLS_PLANNER_INSTRUCTIONS;
    expect(skill).toMatch(/THE OWNER'S WORD WINS/);
    expect(skill).toMatch(/exact code only/);
    expect(skill).toMatch(/do NOT write that a code match alone is not proof/);
    expect(skill).toMatch(/do NOT add that a different colour, size or model does not count/);
    expect(skill).toMatch(/can only search the web\. Never ask it to use a website's own search box/);
  });

  it("tells the planner a code is not unique and that the app adds the product's identity itself", () => {
    const skill = SOURCE_URLS_PLANNER_INSTRUCTIONS;
    // Only a barcode may stand alone; a code is never proof.
    expect(skill).toMatch(/barcode request may search by the barcode alone/);
    expect(skill).toMatch(/SKUs, supplier or vendor codes, MPNs, model numbers and short codes are reused by unrelated products/);
    expect(skill).toMatch(/Never treat such a code as proof that a page is the product/);
    // The identity comes from identityColumns, which the app appends to every request.
    expect(skill).toMatch(/IDENTITY COLUMNS\. The app adds the product's identity to the end of EVERY request/);
    expect(skill).toMatch(/Never list a column that is only a key your requests search by/);
    expect(skill).toMatch(/never list quantity, price, weight, stock, dates, categories, internal codes or images/);
    // The owner's order wins, and a self-check closes the job.
    expect(skill).toMatch(/Follow the owner's order of steps when they gave one/);
    expect(skill).toMatch(/could this return a completely different product\?/);
  });

  it("asks for identityColumns in the answer, and never mentions live links itself", () => {
    const schema = buildSourceUrlsPlannerSchema() as { required: string[]; properties: Record<string, { type: string; items?: { type: string } }> };
    expect(schema.required).toEqual(["steps", "identityColumns", "onlyWebsites", "closestMatch", "notes"]);
    expect(schema.properties.closestMatch).toMatchObject({ type: "boolean" });
    expect(schema.properties.onlyWebsites).toMatchObject({ type: "array", items: { type: "string" } });
    expect(schema.properties.identityColumns).toMatchObject({ type: "array", items: { type: "string" } });
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/live or dead links/);
  });
  it("tells the planner to name a site in onlyWebsites only when the owner limits the search to it", () => {
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/ONLY WEBSITES\. When the owner clearly limits the search to named websites/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/A site the owner merely prefers, tries first or adds to the open web is NOT a limit/);
  });

  it("tells the planner the rules that keep the plan useful", () => {
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/placeholder written as \{\{Column name\}\}/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/EXACTLY 3 requests, strongest first, each from a DIFFERENT ANGLE/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/AT MOST 600 characters/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/Never fill a slot with a mere rewording/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/Request 1 is sent three times at once/);
    expect(SOURCE_URLS_PLANNER_INSTRUCTIONS).toMatch(/Do not mention: JSON/);
  });
});
