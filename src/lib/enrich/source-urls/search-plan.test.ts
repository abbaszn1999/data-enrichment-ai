import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costToCredits, sumCosts } from "@/lib/ai-pricing";
import { getDefaultEnrichmentColumns } from "@/types";
import { enrichRow } from "../agent";
import type { SourceUrlsPlan } from "./plan";
import { SOURCE_URLS_FIXED_RULE, buildSourceUrlsQuery } from "./skill";
import { searchSourceUrls } from "./search";

const aiModeBody = (answer: string, referenceLinks: Array<{ link: string; title?: string }> = []) =>
  JSON.stringify({
    search_metadata: { status: "Success" },
    text_blocks: [{ type: "paragraph", answer }],
    markdown: answer,
    reference_links: referenceLinks,
  });

const PRODUCT = "https://www.mamasandpapas.com/products/check-jacket-3-6-s07fn6db4";
const noPages = () => aiModeBody('{"result":"NOT_FOUND","sources":[]}');
const found = () => aiModeBody(JSON.stringify({ sources: [{ url: PRODUCT, title: "Check Jacket" }] }));

const plan: SourceUrlsPlan = {
  version: 1,
  source: "planner",
  columns: ["Barcode", "Vendor SKU"],
  steps: [
    { name: "Barcode first", text: "Find the product page that sells the product with barcode {{Barcode}}." },
    { name: "SKU on shops", text: "On shop-a.com and shop-b.com find the page for SKU {{Vendor SKU}}." },
  ],
};
const rowData = { Barcode: "5063229294815", "Vendor SKU": "S07FN6DB5", Title: "Check jacket" };
const base = { rowData, customInstruction: "Barcode first, then SKU.", plan, retryDelayMs: 0 };

const queryOf = (fetchMock: { mock: { calls: Array<[string | URL, RequestInit?]> } }, index: number) =>
  new URL(String(fetchMock.mock.calls[index]![0])).searchParams.get("q")!;

describe("searchSourceUrls with a plan", () => {
  beforeEach(() => {
    process.env.SEARCHAPI_API_KEY = "test-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks the plan's requests in order, filled in for the row, each followed by the fixed rule", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ ...base, maxTries: 2 });

    expect(queryOf(fetchMock, 0)).toBe(
      `Find the product page that sells the product with barcode 5063229294815.\n\n${SOURCE_URLS_FIXED_RULE}`
    );
    expect(queryOf(fetchMock, 1)).toBe(
      `On shop-a.com and shop-b.com find the page for SKU S07FN6DB5.\n\n${SOURCE_URLS_FIXED_RULE}`
    );
  });

  it("goes round the plan's requests so all five searches are used, and bills each one", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(base);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect([0, 1, 2, 3, 4].map((i) => queryOf(fetchMock, i).split("\n")[0]!.slice(0, 20))).toEqual([
      "Find the product pag",
      "On shop-a.com and sh",
      "Find the product pag",
      "On shop-a.com and sh",
      "Find the product pag",
    ]);
    expect(result.attempts).toBe(5);
    // Every search is billed exactly once: 5 x $0.004 = $0.02 = 0.2 credits.
    const totals = sumCosts(result.costs);
    expect(result.costs).toHaveLength(5);
    expect(totals.breakdown.searchApiCalls).toBe(5);
    expect(totals.totalCost).toBeCloseTo(0.02, 10);
    expect(totals.totalCredits).toBe(costToCredits(0.02));
    expect(totals.totalCredits).toBe(0.2);
  });

  it("names the request that ran in the not-found note", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(noPages(), { status: 200 })));
    const result = await searchSourceUrls({ ...base, maxTries: 2 });
    expect(result.notFoundReason).toBe(
      'The web search found no page for this item (search 1: "Barcode first" returned no pages; search 2: "SKU on shops" returned no pages).'
    );
  });

  it("stops at the first request that finds a page and bills only the searches made", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => new Response(++calls < 2 ? noPages() : found(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(base);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.costs).toHaveLength(2);
    expect(result.sources.map((s) => s.uri)).toEqual([PRODUCT]);
  });

  it("skips a request when its column is empty on this row", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls({ ...base, rowData: { ...rowData, Barcode: "" }, maxTries: 2 });
    // Both searches are the SKU request: no search is wasted on a blank barcode.
    expect(queryOf(fetchMock, 0)).toContain("SKU S07FN6DB5");
    expect(queryOf(fetchMock, 1)).toContain("SKU S07FN6DB5");
    expect(queryOf(fetchMock, 0)).not.toContain("barcode");
    expect(result.costs).toHaveLength(2);
  });

  it("uses today's query, with the instruction, for a row no request fits", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const only = { Title: "Check jacket" };
    await searchSourceUrls({ ...base, rowData: only, maxTries: 2 });
    const expected = buildSourceUrlsQuery({ rowData: only, customInstruction: base.customInstruction });
    expect(queryOf(fetchMock, 0)).toBe(expected);
    expect(queryOf(fetchMock, 1)).toBe(expected);
  });

  it("adds the photo line, and the photo, to a planned request", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(found(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ ...base, imageUrl: "https://cdn.example.com/jacket.jpg", location: "United Kingdom" });
    const params = new URL(String(fetchMock.mock.calls[0]![0])).searchParams;
    expect(params.get("url")).toBe("https://cdn.example.com/jacket.jpg");
    expect(params.get("location")).toBe("United Kingdom");
    expect(params.get("q")).toContain("The attached photo shows the same product.");
  });

  it("does not bill the photo call that Google refused, only the answered search", async () => {
    const fetchMock = vi.fn(async (...args: [string | URL, RequestInit?]) =>
      new URL(String(args[0])).searchParams.has("url")
        ? new Response("bad image", { status: 400 })
        : new Response(found(), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls({ ...base, imageUrl: "https://cdn.example.com/jacket.jpg" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.costs).toHaveLength(1);
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get("q")).not.toContain("attached photo");
  });

  it("keeps what earlier searches billed when a later one fails", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++calls < 3 ? new Response(noPages(), { status: 200 }) : new Response("bad request", { status: 400 })))
    );
    const result = await searchSourceUrls(base);
    expect(result.sources).toEqual([]);
    expect(result.costs).toHaveLength(2);
    expect(result.notFoundReason).toMatch(/search 3 failed/);
  });

  it("without a plan every try is today's one query", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ rowData, customInstruction: "x", maxTries: 3 });
    const expected = buildSourceUrlsQuery({ rowData, customInstruction: "x" });
    expect([0, 1, 2].map((i) => queryOf(fetchMock, i))).toEqual([expected, expected, expected]);
  });
});

describe("the Source URLs column with a saved plan", () => {
  const column = getDefaultEnrichmentColumns("product").find((c) => c.id === "sourceUrls")!;
  const params = (sourceUrlsPlan: unknown) => ({
    productData: rowData,
    settings: { enrichmentModel: "standard" as const, outputLanguage: "English" },
    kind: "product" as const,
    enabledColumns: ["sourceUrls"],
    enrichmentColumns: [{ ...column, enabled: true, customInstruction: "Barcode first." }],
    sourceUrlsPlan: sourceUrlsPlan as SourceUrlsPlan | undefined,
  });

  beforeEach(() => {
    process.env.SEARCHAPI_API_KEY = "test-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("follows the plan the job saved", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(found(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await enrichRow(params(plan));
    expect(queryOf(fetchMock, 0)).toContain("barcode 5063229294815");
    expect(result.data.sourceUrls).toEqual([{ title: "Check Jacket", uri: PRODUCT }]);
    expect(result.costs).toHaveLength(1);
  });

  it("falls back to the default query, never a crash, when the saved plan is damaged", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(found(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await enrichRow(params({ version: 1, source: "planner", steps: [{ name: "x", text: "{{Nope}} nothing to find" }], columns: [] }));
    expect(queryOf(fetchMock, 0)).toBe(buildSourceUrlsQuery({ rowData, customInstruction: "Barcode first." }));
    fetchMock.mockClear();
    await enrichRow(params("garbage"));
    expect(queryOf(fetchMock, 0)).toBe(buildSourceUrlsQuery({ rowData, customInstruction: "Barcode first." }));
  });
});
