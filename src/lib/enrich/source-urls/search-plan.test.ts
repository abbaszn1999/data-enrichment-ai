import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costToCredits, sumCosts } from "@/lib/ai-pricing";
import { getDefaultEnrichmentColumns } from "@/types";
import { enrichRow } from "../agent";
import type { SourceUrlsPlan } from "./plan";
import {
  LIVE_LINKS_RULE,
  SOURCE_URLS_FIXED_RULE,
  SOURCE_URLS_FIXED_RULE_CLOSEST,
  SOURCE_URLS_IDENTITY_HEADING,
  buildSourceUrlsQuery,
} from "./skill";
import { searchSourceUrls, SOURCE_URLS_MAX_TRIES, SOURCE_URLS_TRIES_BUDGET_MS } from "./search";

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
  columns: ["Barcode", "Vendor SKU", "Title"],
  identityColumns: ["Title"],
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

  it("asks the first request in round 1 and the second in round 2, filled in for the row, each followed by the identity and the fixed rule", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls(base);

    const barcodeQuery = `Find the product page that sells the product with barcode 5063229294815.\n\n${SOURCE_URLS_IDENTITY_HEADING}\n- Title: Check jacket\n\n${SOURCE_URLS_FIXED_RULE}`;
    const skuQuery = `On shop-a.com and shop-b.com find the page for SKU S07FN6DB5.\n\n${SOURCE_URLS_IDENTITY_HEADING}\n- Title: Check jacket\n\n${SOURCE_URLS_FIXED_RULE}`;
    expect([0, 1, 2, 3, 4].map((i) => queryOf(fetchMock, i))).toEqual([barcodeQuery, barcodeQuery, barcodeQuery, skuQuery, skuQuery]);
  });

  it("sends the three searches of a round at the same moment, not one after another", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response(noPages(), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls(base);
    // Round 1 has three searches, round 2 has two: never more than three at once.
    expect(peak).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("sends the first request three times, then the second twice, and bills each of the five", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(base);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect([0, 1, 2, 3, 4].map((i) => queryOf(fetchMock, i).split("\n")[0]!.slice(0, 20))).toEqual([
      "Find the product pag",
      "Find the product pag",
      "Find the product pag",
      "On shop-a.com and sh",
      "On shop-a.com and sh",
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
    const result = await searchSourceUrls(base);
    expect(result.notFoundReason).toBe(
      'The web search found no page for this item (searches 1-3: "Barcode first" returned no pages; searches 4-5: "SKU on shops" returned no pages).'
    );
  });

  it("finds the page in round 1, sends no round 2, and bills only the three searches made", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => new Response(++calls < 2 ? noPages() : found(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(base);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.attempts).toBe(3);
    expect(result.costs).toHaveLength(3);
    expect(result.sources.map((s) => s.uri)).toEqual([PRODUCT]);
  });

  it("goes to round 2 only when round 1 found nothing, and its two requests are sent together", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(++calls <= 3 ? noPages() : found(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(base);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.attempts).toBe(5);
    expect(result.costs).toHaveLength(5);
    expect(result.sources.map((s) => s.uri)).toEqual([PRODUCT]);
    // The two round-2 searches are the second request, one for each.
    expect(queryOf(fetchMock, 3)).toContain("shop-a.com");
    expect(queryOf(fetchMock, 4)).toContain("shop-a.com");
  });

  it("puts a page that more of the three answers name first", async () => {
    const popular = "https://www.mamasandpapas.com/products/check-jacket-3-6-s07fn6db4";
    const rare = "https://other.example.com/p/check-jacket";
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        // Answer 1 lists the rare page first; answers 2 and 3 both name the popular page.
        const list = calls === 1 ? [{ url: rare, title: "Rare" }, { url: popular, title: "Popular" }] : [{ url: popular, title: "Popular" }];
        return new Response(aiModeBody(JSON.stringify({ sources: list })), { status: 200 });
      })
    );
    const result = await searchSourceUrls(base);
    expect(result.sources.map((s) => s.uri)).toEqual([popular, rare]);
  });

  it("never sends a bare code: the Buki toy row's code search always carries its brand and name", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const buki = { "Internal code": "TE45200", "Supplier code": "TA001", Barcode: "3700802102649", Name: "75 Wash-Off Tattoos - Assortment", Brand: "Buki", Qty: "6" };
    const codeOnly: SourceUrlsPlan = {
      version: 1,
      source: "planner",
      columns: Object.keys(buki),
      identityColumns: ["Brand", "Name"],
      steps: [
        { name: "Barcode", text: "Find the pages that show the exact barcode {{Barcode}}." },
        { name: "Supplier code", text: "Find the page for supplier code {{Supplier code}}." },
      ],
    };
    await searchSourceUrls({ rowData: buki, plan: codeOnly, retryDelayMs: 0 });
    for (const index of [0, 1, 2, 3, 4]) {
      const query = queryOf(fetchMock, index);
      expect(query).toContain(SOURCE_URLS_IDENTITY_HEADING);
      expect(query).toContain("- Brand: Buki");
      expect(query).toContain("- Name: 75 Wash-Off Tattoos - Assortment");
      // Not the columns that do not say what the item is.
      expect(query).not.toContain("TE45200");
      expect(query).not.toContain("Qty");
    }
    // Round 1 is the barcode, three times; round 2 is the supplier code, twice.
    expect(queryOf(fetchMock, 0)).toContain("exact barcode 3700802102649");
    expect(queryOf(fetchMock, 3)).toContain("supplier code TA001");
  });

  describe("when the owner limited the search to a website", () => {
    const JUNK = [
      { url: "https://particlesearch.com/features/variant-search", title: "Variant search for Shopify" },
      { url: "https://www.price2spy.com/blog/product-matching-in-ecommerce/", title: "What Is Product Matching in eCommerce?" },
    ];
    const limited: SourceUrlsPlan = { ...plan, onlyWebsites: ["mamasandpapas.com"] };

    it("drops pages from other websites and keeps the shop's own page", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(aiModeBody(JSON.stringify({ sources: [...JUNK, { url: PRODUCT, title: "Check Jacket" }] })), { status: 200 }))
      );
      const result = await searchSourceUrls({ ...base, plan: limited });
      expect(result.sources.map((s) => s.uri)).toEqual([PRODUCT]);
    });

    it("treats a round that returns only other websites as not found, so round 2 runs, and says why", async () => {
      const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(aiModeBody(JSON.stringify({ sources: JUNK })), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const result = await searchSourceUrls({ ...base, plan: limited });
      expect(result.sources).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(result.costs).toHaveLength(5);
      expect(result.notFoundReason).toMatch(/returned 2 page\(s\), all rejected: 2 not on mamasandpapas\.com/);
    });

    it("keeps those pages when no website was limited", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(aiModeBody(JSON.stringify({ sources: JUNK })), { status: 200 })));
      const result = await searchSourceUrls({ ...base, maxTries: 1 });
      expect(result.sources.map((s) => s.uri)).toContain(JUNK[0]!.url);
    });
  });

  it("uses the ticked columns as the identity when the planner chose none, except those the request already contains", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ ...base, plan: { ...plan, identityColumns: undefined }, maxTries: 1 });
    const query = queryOf(fetchMock, 0);
    // The barcode is what request 1 searches for, so it is not repeated as identity.
    expect(query).not.toContain("- Barcode:");
    expect(query).toContain("- Vendor SKU: S07FN6DB5");
    expect(query).toContain("- Title: Check jacket");
  });

  it("sends no identity block when the only ticked column is the code the request searches for", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const codeOnly: SourceUrlsPlan = {
      version: 1,
      source: "planner",
      columns: ["Code"],
      steps: [{ name: "Code", text: 'Search toys4less.com for the exact code "{{Code}}".' }],
    };
    await searchSourceUrls({ rowData: { Code: "SSP1486359" }, customInstruction: "exact code only", plan: codeOnly, retryDelayMs: 0, maxTries: 1 });
    const query = queryOf(fetchMock, 0);
    expect(query).toContain('exact code "SSP1486359"');
    expect(query).not.toContain("- Code:");
    expect(query).not.toContain(SOURCE_URLS_IDENTITY_HEADING);
  });

  it("keeps the strict 'this exact item' rule unless the plan allows a closest match", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ ...base, maxTries: 1 });
    const strict = queryOf(fetchMock, 0);
    expect(strict).toContain(SOURCE_URLS_FIXED_RULE);
    expect(strict).toContain("page of one product, this exact item");
    expect(strict).not.toContain("the same product it belongs to");

    fetchMock.mockClear();
    await searchSourceUrls({ ...base, plan: { ...plan, closestMatch: false }, maxTries: 1 });
    expect(queryOf(fetchMock, 0)).toContain(SOURCE_URLS_FIXED_RULE);
  });

  it("relaxes the two 'exact item' lines, and nothing else, when the plan allows a closest match", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(noPages(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ ...base, plan: { ...plan, closestMatch: true }, maxTries: 1 });
    const query = queryOf(fetchMock, 0);
    expect(query).toContain(SOURCE_URLS_FIXED_RULE_CLOSEST);
    expect(query).not.toContain(SOURCE_URLS_FIXED_RULE);
    expect(query).not.toContain("page of one product, this exact item");
    expect(query).not.toContain("for this exact item as you can find");
    expect(query).not.toContain("a page for this exact item");
    expect(query).toContain("the page of the same product it belongs to");
    // Still forbidden, still said: pages that are not product pages, dead links, and the answer format.
    expect(query).toContain("Never return a home page, category, collection, brand, search-results, blog or article page.");
    expect(query).toContain(LIVE_LINKS_RULE);
    expect(query).toContain('return {"sources":[]}');
    expect(query).toContain('{"sources":[{"url":"https://...","title":"page title"}]}');
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
    const result = await searchSourceUrls({ ...base, imageUrl: "https://cdn.example.com/jacket.jpg", maxTries: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.costs).toHaveLength(1);
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get("q")).not.toContain("attached photo");
  });

  it("keeps what the searches that answered billed when the others fail", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++calls < 3 ? new Response(noPages(), { status: 200 }) : new Response("bad request", { status: 400 })))
    );
    const result = await searchSourceUrls(base);
    expect(result.sources).toEqual([]);
    expect(result.costs).toHaveLength(2);
    expect(result.notFoundReason).toMatch(/searches 1-2: "Barcode first" returned no pages; search 3: "Barcode first" failed: Web search failed \(400\)/);
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
    // The three searches of round 1.
    expect(result.costs).toHaveLength(3);
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

describe("the time a row can spend searching", () => {
  it("keeps even the worst last search inside the row limit, so no billed search is ever lost to a kill", () => {
    // The last search may start at the budget and run four 120 s calls (photo, its retry, then without the photo and its retry) plus the 2 s pauses.
    const worstLastSearchMs = 4 * 120_000 + 2 * 2_000;
    expect(SOURCE_URLS_MAX_TRIES).toBe(5);
    expect(SOURCE_URLS_TRIES_BUDGET_MS + worstLastSearchMs).toBeLessThan(900_000);
  });
});
