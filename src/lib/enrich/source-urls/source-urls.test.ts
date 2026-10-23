import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultEnrichmentColumns } from "@/types";
import { enrichRow } from "../agent";
import { billedCostsOf, OPENAI_RESPONSES_URL } from "../openai";
import { checkExactLinksDetailed } from "../image-finder/exact/links-checks";
import { buildExactLinksQuery } from "../image-finder/exact/links-skill";
import { usesGoogleSourceUrls } from "./agent";
import { looksLikeListingPage, pageKey, rankSources, searchSourceUrls } from "./search";
import {
  buildSourceUrlsQuery,
  cleanPageTitle,
  harvestSourceCandidates,
  parseBestSourceAnswer,
  parseSourceUrlsAnswer,
  SOURCE_URLS_MAX,
} from "./skill";

const SEARCHAPI_HOST = "https://www.searchapi.io/api/v1/search";

function aiModeBody(answer: string, referenceLinks: Array<{ link: string; title?: string }> = []) {
  return JSON.stringify({
    search_metadata: { status: "Success" },
    text_blocks: [{ type: "paragraph", answer }],
    markdown: answer,
    reference_links: referenceLinks,
  });
}

const FOUND_ANSWER = JSON.stringify({
  result: "FOUND",
  sources: [
    { url: "https://www.acme.com/products/widget-wx-1", title: "Widget WX-1 | Acme", matchedOn: "code", evidence: "WX-1", differences: "none" },
    { url: "https://shop.example.com/p/widget-wx-1", title: "Acme Widget WX-1", matchedOn: "code", evidence: "WX-1", differences: "none" },
  ],
});

const WEB_RESULTS_ANSWER = [
  "## Web Results",
  "",
  "| # | Title | Source | Snippet |",
  "| --- | --- | --- | --- |",
  "| 1 | [The Widget \\\\| Acme](https://www.acme.com/products/widget) | Acme · https://www.acme.com | A widget. |",
  "| 2 | [Acme store](https://www.amazon.com/stores/Acme/page/ABC) | Amazon · https://www.amazon.com | Store. |",
  "| 3 | [Widget at Shop](https://shop.example.com/p/widget) | Shop · https://shop.example.com | Buy. |",
].join("\n");

const row = { Title: "Widget WX-1", Brand: "Acme" };

describe("Source URLs query", () => {
  it("is a short task: the product, the custom instruction and the output format", () => {
    const query = buildSourceUrlsQuery({ rowData: row, customInstruction: "Prefer the manufacturer's own site." });
    expect(query).toContain("Find every web page that sells this exact product");
    expect(query).toContain("- Title: Widget WX-1");
    expect(query).toContain("- Brand: Acme");
    expect(query).toContain("Prefer the manufacturer's own site.");
    expect(query).toContain('"sources":[');
    expect(query.length).toBeLessThan(900);
  });

  it("puts the custom instruction last before the output format and ranks it above the default rules", () => {
    const query = buildSourceUrlsQuery({ rowData: row, customInstruction: "Start with the SKU." });
    const defaults = query.indexOf("Same product only.");
    const instruction = query.indexOf("Instruction from the store owner");
    const format = query.indexOf("as JSON only:");
    expect(defaults).toBeGreaterThan(-1);
    expect(instruction).toBeGreaterThan(defaults);
    expect(format).toBeGreaterThan(instruction);
    expect(query).toContain("it takes priority over the rules above, except the JSON format below): Start with the SKU.");
  });

  it("has no page count, no website rules and no strict rulebook", () => {
    const query = buildSourceUrlsQuery({ rowData: row, customInstruction: "x" });
    expect(query).not.toMatch(/up to \d|maximum \d/i);
    expect(query).not.toMatch(/website rules|STEP \d|identified by|never pad/i);
  });

  it("asks for every kind of seller, manufacturers and Chinese sources included, in any language", () => {
    const query = buildSourceUrlsQuery({ rowData: row });
    expect(query).toContain("from any seller in any country or language");
    expect(query).toContain("the brand's own site, manufacturers and factories (for example Alibaba, 1688)");
    expect(query).toContain("wholesalers, retailers and marketplaces");
    expect(query).toContain("Aim for 10 or more pages");
    expect(query).toContain("A different colour, size or model does not count");
    expect(query).toContain("(no search or category pages), best first, as JSON only");
  });

  it("mentions the photo only when one is sent, and works with the photo alone", () => {
    // Text only: no photo wording.
    expect(buildSourceUrlsQuery({ rowData: row })).not.toContain("photo");

    // Photo only: identify first, no PRODUCT block.
    const photoOnly = buildSourceUrlsQuery({ rowData: { Img: "[1 image attached]" }, hasImage: true });
    expect(photoOnly).toContain("Identify the product in the attached photo, then find every web page that sells that exact product");
    expect(photoOnly).not.toContain("PRODUCT");
    expect(photoOnly).not.toContain("No usable product data");

    // Text and photo: the photo confirms the match.
    const both = buildSourceUrlsQuery({ rowData: row, hasImage: true });
    expect(both).toContain("Find every web page that sells this exact product");
    expect(both).toContain("- Title: Widget WX-1");
    expect(both).toContain("The attached photo shows the same product.");
    expect(both).not.toContain("Identify the product in the attached photo");

    // Neither: says so plainly.
    expect(buildSourceUrlsQuery({ rowData: {} })).toContain("No usable product data was provided.");
  });

  it("leaves out the instruction line without one, and asks for other angles on attempt 2", () => {
    expect(buildSourceUrlsQuery({ rowData: row })).not.toContain("Instruction from the store owner");
    expect(buildSourceUrlsQuery({ rowData: row, customInstruction: "   " })).not.toContain("Instruction from the store owner");
    expect(buildSourceUrlsQuery({ rowData: row, attempt: 2 })).toContain("beyond the obvious");
  });

  it("never lets the fields push the output format out of the query", () => {
    const rowData = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Field ${i}`, "x".repeat(300)]));
    const query = buildSourceUrlsQuery({ rowData, customInstruction: "y".repeat(5000) });
    expect(query.length).toBeLessThanOrEqual(8_000);
    expect(query).toContain('{"sources":[{"url"');
  });

  it("leaves image attachments and image links out of the product fields", () => {
    const query = buildSourceUrlsQuery({
      rowData: { Title: "Widget", Photos: "[3 images attached]", Img: "https://cdn.example.com/a.jpg" },
    });
    expect(query).toContain("- Title: Widget");
    expect(query).not.toContain("Photos");
    expect(query).not.toContain("cdn.example.com");
  });
});

describe("Image Finder's Exact Match prompt is not affected", () => {
  it("still asks for the strict, code-proven, up-to-10 matches", () => {
    const query = buildExactLinksQuery({ rowData: row, rowIdentifiers: ["WX-1"] });
    expect(query).toContain("Find product pages for this exact item, identified by: WX-1 (full row below).");
    expect(query).toContain("STEP 2 — DECIDE THE IDENTITY PATH");
    expect(query).toContain("STEP 5 — CONFIRM EACH LINK");
    expect(query).toContain("UP TO 10");
    expect(query).toContain("Never pad the list with near matches");
    expect(query).toContain('"result":"MATCHES_FOUND" or "NO_EXACT_MATCH"');
    expect(buildSourceUrlsQuery({ rowData: row })).not.toBe(query);
  });

  it("still takes only https:// pages (plain http is a Source URLs-only option)", () => {
    const candidates = [{ url: "http://shop.example.com/p/widget" }, { url: "https://shop.example.com/p/widget" }];
    expect(checkExactLinksDetailed(candidates, []).links.map((l) => l.url)).toEqual(["https://shop.example.com/p/widget"]);
    expect(checkExactLinksDetailed(candidates, [], 10, undefined, { allowHttp: true }).links).toHaveLength(2);
  });
});

describe("Source URLs answer parsing", () => {
  it("reads the JSON object, even inside prose and code fences", () => {
    const parsed = parseSourceUrlsAnswer(`Here you go:\n\`\`\`json\n${FOUND_ANSWER}\n\`\`\``);
    expect(parsed.readable).toBe(true);
    expect(parsed.sources.map((s) => s.url)).toEqual([
      "https://www.acme.com/products/widget-wx-1",
      "https://shop.example.com/p/widget-wx-1",
    ]);
    expect(parsed.sources[0]?.title).toBe("Widget WX-1 | Acme");
  });

  it("reads a bare list of links and the other key names", () => {
    expect(parseSourceUrlsAnswer('["https://a.example.com/p/1"]').sources).toHaveLength(1);
    expect(parseSourceUrlsAnswer('{"links":[{"link":"https://a.example.com/p/1"}]}').sources).toHaveLength(1);
  });

  it("tells an explicit 'none' from an unreadable answer", () => {
    const none = parseSourceUrlsAnswer('{"result":"NOT_FOUND","sources":[]}');
    expect(none).toMatchObject({ readable: true, sources: [] });
    expect(parseSourceUrlsAnswer("I could not find that product.").readable).toBe(false);
  });

  it("prefers the rendering that lists links", () => {
    const parsed = parseBestSourceAnswer(['{"result":"NOT_FOUND","sources":[]}', FOUND_ANSWER]);
    expect(parsed.sources).toHaveLength(2);
  });

  it("harvests [title](url) links from a web-results answer and cleans titles", () => {
    const leads = harvestSourceCandidates([WEB_RESULTS_ANSWER], ["https://ref.example.com/p/9"]);
    expect(leads.map((l) => l.url)).toEqual([
      "https://www.acme.com/products/widget",
      "https://www.amazon.com/stores/Acme/page/ABC",
      "https://shop.example.com/p/widget",
      "https://www.acme.com",
      "https://www.amazon.com",
      "https://shop.example.com",
      "https://ref.example.com/p/9",
    ]);
    expect(leads[0]?.title).toBe("The Widget | Acme");
    expect(cleanPageTitle("Logitech MX Master 3S - BlackGo to product viewer dialog for this item.")).toBe(
      "Logitech MX Master 3S - Black"
    );
  });
});

describe("Source URLs ranking", () => {
  it("keys pages by host and path", () => {
    expect(pageKey("https://www.Acme.com/p/1/?variant=2#reviews")).toBe("acme.com/p/1");
  });

  it("recognises shop listing pages", () => {
    expect(looksLikeListingPage("https://www.amazon.com/stores/Acme/page/ABC")).toBe(true);
    expect(looksLikeListingPage("https://www.amazon.com/clp/B0CP9Z1S51")).toBe(true);
    expect(looksLikeListingPage("https://shop.example.com/search?q=widget")).toBe(true);
    expect(looksLikeListingPage("https://www.amazon.com/dyson-v15-detect/s?k=dyson+v15")).toBe(true);
    expect(looksLikeListingPage("https://www.walmart.com/c/kp/stanley-quencher")).toBe(true);
    expect(looksLikeListingPage("https://www.walmart.com/ip/Anker-735/1710516052")).toBe(false);
    expect(looksLikeListingPage("https://www.amazon.com/dp/B0CP9Z1S51")).toBe(false);
    expect(looksLikeListingPage("https://shop.example.com/products/widget-wx-1")).toBe(false);
  });

  it("puts pages Google itself cited first, with Google's title, and keeps the others after them", () => {
    const ranked = rankSources(
      [
        { url: "https://a.example.com/p/1", title: "A" },
        { url: "https://b.example.com/p/2", title: "B" },
        { url: "https://c.example.com/p/3", title: "C" },
      ],
      [{ link: "https://b.example.com/p/2#:~:text=x", title: "B from Google" }]
    );
    expect(ranked).toEqual([
      { title: "B from Google", uri: "https://b.example.com/p/2" },
      { title: "A", uri: "https://a.example.com/p/1" },
      { title: "C", uri: "https://c.example.com/p/3" },
    ]);
  });

  it("stops at the safety cap", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ url: `https://s${i}.example.com/p/1` }));
    expect(rankSources(many, [])).toHaveLength(SOURCE_URLS_MAX);
    expect(rankSources(many, [], 2)).toHaveLength(2);
  });

  it("keeps the checked pages when Google cited none, and falls back to the host for a title", () => {
    const ranked = rankSources([{ url: "https://a.example.com/p/1" }, { url: "https://b.example.com/p/2", title: "B" }], [], 1);
    expect(ranked).toEqual([{ title: "a.example.com", uri: "https://a.example.com/p/1" }]);
  });
});

describe("searchSourceUrls", () => {
  beforeEach(() => {
    process.env.SEARCHAPI_API_KEY = "test-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const input = { rowData: row };

  it("returns the pages from one search and records one SearchApi charge", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(aiModeBody(FOUND_ANSWER), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(input);
    expect(result.sources.map((s) => s.uri)).toEqual([
      "https://www.acme.com/products/widget-wx-1",
      "https://shop.example.com/p/widget-wx-1",
    ]);
    expect(result.attempts).toBe(1);
    expect(result.costs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("&url=");
  });

  it("sends one photo with the search and tells the prompt about it", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(aiModeBody(FOUND_ANSWER), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls({ ...input, imageUrl: "https://cdn.example.com/widget.jpg" });
    const called = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(called.searchParams.get("url")).toBe("https://cdn.example.com/widget.jpg");
    expect(called.searchParams.get("q")).toContain("The attached photo shows the same product.");
    expect(result.usedImage).toBe(true);
  });

  it("retries without the photo when Google cannot take it, and no longer claims one", async () => {
    const fetchMock = vi.fn(async (...args: [string | URL, RequestInit?]) =>
      new URL(String(args[0])).searchParams.has("url")
        ? new Response("bad image", { status: 400 })
        : new Response(aiModeBody(FOUND_ANSWER), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls({ ...input, imageUrl: "https://cdn.example.com/widget.jpg" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get("q")).not.toContain("attached photo");
    expect(result.usedImage).toBe(false);
    expect(result.sources).toHaveLength(2);
    // The failed call was not billed (non-200), only the answered one.
    expect(result.costs).toHaveLength(1);
  });

  it("does not send a photo it cannot link to (data: or relative)", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(aiModeBody(FOUND_ANSWER), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ ...input, imageUrl: "data:image/png;base64,AAAA" });
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.has("url")).toBe(false);
  });

  it("uses Google's web-results answer instead of reporting 'none found', minus listing pages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(aiModeBody(WEB_RESULTS_ANSWER), { status: 200 })));
    const result = await searchSourceUrls(input);
    expect(result.sources.map((s) => s.uri)).toEqual([
      "https://www.acme.com/products/widget",
      "https://shop.example.com/p/widget",
    ]);
    expect(result.attempts).toBe(1);
  });

  it("searches a second time with new angles when the first finds nothing, and explains a miss", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) =>
      new Response(aiModeBody('{"result":"NOT_FOUND","sources":[]}'), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get("q")).toContain("beyond the obvious");
    expect(result.sources).toEqual([]);
    expect(result.costs).toHaveLength(2);
    expect(result.notFoundReason).toMatch(/search 1: returned no pages; search 2: returned no pages/);
  });

  it("keeps the first search's answer when the second search fails", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response(aiModeBody('{"result":"NOT_FOUND","sources":[]}'), { status: 200 })
          : new Response("boom", { status: 503 });
      })
    );
    const result = await searchSourceUrls({ ...input, retryDelayMs: 0 });
    expect(result.sources).toEqual([]);
    expect(result.costs).toHaveLength(1);
    expect(result.notFoundReason).toMatch(/search 2 failed/);
  });

  it("throws when the first search fails, after one retry (nothing was billed)", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchSourceUrls({ ...input, retryDelayMs: 0 })).rejects.toThrow(/failed \(500\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tries a rate-limited search once more and charges only the answered call", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response("slow down", { status: 429 })
        : new Response(aiModeBody(FOUND_ANSWER), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls({ ...input, retryDelayMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.sources).toHaveLength(2);
    expect(result.costs).toHaveLength(1);
  });

  it("does not retry a request SearchApi rejects outright (4xx)", async () => {
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchSourceUrls({ ...input, retryDelayMs: 0 })).rejects.toThrow(/failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps every page it finds, not just a few, up to the safety cap", async () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({
      url: `https://shop${i}.example.com/p/widget-wx-1`,
      title: `Shop ${i}`,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(aiModeBody(JSON.stringify({ sources: pages })), { status: 200 })));
    const result = await searchSourceUrls(input);
    expect(result.sources).toHaveLength(SOURCE_URLS_MAX);
    expect(result.sources[0]).toEqual({ title: "Shop 0", uri: "https://shop0.example.com/p/widget-wx-1" });
    expect(result.attempts).toBe(1);
  });

  it("keeps manufacturer and wholesale pages, including plain http:// ones", async () => {
    const answer = JSON.stringify({
      sources: [
        { url: "http://www.acme-factory.cn/product/widget-wx-1.html", title: "Acme factory" },
        { url: "https://detail.1688.com/offer/123456.html", title: "1688 offer" },
        { url: "https://www.alibaba.com/product-detail/Widget-WX-1_1600123.html", title: "Alibaba" },
        { url: "https://www.example.com/", title: "bare domain" },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(aiModeBody(answer), { status: 200 })));
    const result = await searchSourceUrls(input);
    expect(result.sources.map((s) => s.uri)).toEqual([
      "http://www.acme-factory.cn/product/widget-wx-1.html",
      "https://detail.1688.com/offer/123456.html",
      "https://www.alibaba.com/product-detail/Widget-WX-1_1600123.html",
    ]);
  });

  it("does not search a second time when the first search found pages, however few", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) =>
      new Response(aiModeBody(JSON.stringify({ sources: [{ url: "https://shop.example.com/p/widget-wx-1", title: "Shop" }] })), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(input);
    expect(result.sources).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Source URLs routing in enrichRow", () => {
  const defaults = getDefaultEnrichmentColumns("product");
  const titleTag = { ...defaults.find((c) => c.id === "titleTag")!, enabled: true };
  const sourceUrls = defaults.find((c) => c.id === "sourceUrls")!;
  const baseParams = {
    productData: row,
    settings: { enrichmentModel: "standard" as const, outputLanguage: "English" },
    kind: "product" as const,
  };
  const usage = { input_tokens: 1_000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 500 };
  const openAiOk = {
    id: "r1",
    status: "completed",
    usage,
    output: [
      { type: "web_search_call", action: { type: "search", query: "Widget WX-1" } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ titleTag: "Widget WX-1 by Acme", notes: "" }) }] },
    ],
  };

  function stubBoth(options: { openAi?: unknown; googleStatus?: number; googleBody?: string }) {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url === OPENAI_RESPONSES_URL) return new Response(JSON.stringify(options.openAi ?? openAiOk), { status: 200 });
      if (url.startsWith(SEARCHAPI_HOST)) {
        return new Response(options.googleBody ?? aiModeBody(FOUND_ANSWER), { status: options.googleStatus ?? 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const callsTo = (fetchMock: ReturnType<typeof stubBoth>, prefix: string) =>
    fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(prefix));

  beforeEach(() => {
    process.env.SEARCHAPI_API_KEY = "test-key";
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("only routes the `sourceUrls` id of a product sheet to Google, never Image sources or PLP", () => {
    expect(usesGoogleSourceUrls("product", ["sourceUrls"])).toBe(true);
    expect(usesGoogleSourceUrls("product", ["titleTag", "sourceUrls"])).toBe(true);
    expect(usesGoogleSourceUrls("product", ["imageUrls", "imageSourceUrls"])).toBe(false);
    expect(usesGoogleSourceUrls("product", ["titleTag"])).toBe(false);
    expect(usesGoogleSourceUrls("plp", ["sourceUrls"])).toBe(false);
  });

  it("makes no OpenAI call when Source URLs is the only column", async () => {
    const fetchMock = stubBoth({});
    const result = await enrichRow({ ...baseParams, enabledColumns: ["sourceUrls"], enrichmentColumns: [sourceUrls] });
    expect(callsTo(fetchMock, OPENAI_RESPONSES_URL)).toHaveLength(0);
    expect(callsTo(fetchMock, SEARCHAPI_HOST)).toHaveLength(1);
    expect(result.data.sourceUrls).toHaveLength(2);
    expect(result.data["sourceUrls__notFoundReason"]).toBe("");
    expect(result.costs).toHaveLength(1);
  });

  it("uses the column's custom instruction and the first photo in the Google search", async () => {
    const fetchMock = stubBoth({});
    await enrichRow({
      ...baseParams,
      enabledColumns: ["sourceUrls"],
      enrichmentColumns: [{ ...sourceUrls, customInstruction: "Only Acme's own website." }],
      sourceImageUrls: ["data:image/png;base64,AAAA", "https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"],
    });
    const called = new URL(String(callsTo(fetchMock, SEARCHAPI_HOST)[0]![0]));
    expect(called.searchParams.get("url")).toBe("https://cdn.example.com/one.jpg");
    expect(called.searchParams.get("q")).toContain("Only Acme's own website.");
  });

  it("runs OpenAI for the other columns and Google for Source URLs, then merges both", async () => {
    const fetchMock = stubBoth({});
    const result = await enrichRow({
      ...baseParams,
      enabledColumns: ["titleTag", "sourceUrls"],
      enrichmentColumns: [titleTag, sourceUrls],
    });
    expect(callsTo(fetchMock, OPENAI_RESPONSES_URL)).toHaveLength(1);
    expect(callsTo(fetchMock, SEARCHAPI_HOST)).toHaveLength(1);
    const openAiBody = JSON.parse(String((callsTo(fetchMock, OPENAI_RESPONSES_URL)[0]![1] as RequestInit).body));
    expect(openAiBody.instructions).toContain("Columns to fill (1):");
    expect(openAiBody.instructions).not.toContain("sourceUrls");
    expect(result.data.titleTag).toBe("Widget WX-1 by Acme");
    expect(result.data.sourceUrls).toHaveLength(2);
    expect(result.costs).toHaveLength(2);
  });

  it("keeps the OpenAI columns when the Google search fails, and says why the cell is empty", async () => {
    stubBoth({ googleStatus: 400, googleBody: "boom" });
    const result = await enrichRow({
      ...baseParams,
      enabledColumns: ["titleTag", "sourceUrls"],
      enrichmentColumns: [titleTag, sourceUrls],
    });
    expect(result.data.titleTag).toBe("Widget WX-1 by Acme");
    expect(result.data.sourceUrls).toEqual([]);
    expect(String(result.data["sourceUrls__notFoundReason"])).toMatch(/Run this column again/);
    expect(result.costs).toHaveLength(1);
  });

  it("fails the row when Source URLs is the only column and Google fails", async () => {
    stubBoth({ googleStatus: 400, googleBody: "boom" });
    await expect(
      enrichRow({ ...baseParams, enabledColumns: ["sourceUrls"], enrichmentColumns: [sourceUrls] })
    ).rejects.toThrow(/failed \(400\)/);
  });

  it("reuses the Google answer on the row's next attempt instead of paying for it twice", async () => {
    const incomplete = {
      id: "r1",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage,
      output: [{ type: "web_search_call", action: { type: "search", query: "a" } }],
    };
    let openAiCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === OPENAI_RESPONSES_URL) {
        openAiCalls += 1;
        return new Response(JSON.stringify(openAiCalls === 1 ? incomplete : openAiOk), { status: 200 });
      }
      return new Response(aiModeBody(FOUND_ANSWER), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const memo = {};
    const params = {
      ...baseParams,
      enabledColumns: ["titleTag", "sourceUrls"],
      enrichmentColumns: [titleTag, sourceUrls],
      sourceUrlsMemo: memo,
    };
    const first = await enrichRow(params).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(Error);
    expect(billedCostsOf(first).filter((c) => (c.searchApiCalls ?? 0) > 0)).toHaveLength(1);

    const second = await enrichRow(params);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(SEARCHAPI_HOST))).toHaveLength(1);
    expect(second.data.sourceUrls).toHaveLength(2);
    expect(second.data.titleTag).toBe("Widget WX-1 by Acme");
    // The retry is charged for OpenAI only; Google was charged with the first attempt.
    expect(second.costs.filter((c) => (c.searchApiCalls ?? 0) > 0)).toHaveLength(0);
  });

  it("still charges what Google billed when the OpenAI call fails", async () => {
    stubBoth({
      openAi: {
        id: "r1",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        usage,
        output: [{ type: "web_search_call", action: { type: "search", query: "a" } }],
      },
    });
    const error = await enrichRow({
      ...baseParams,
      enabledColumns: ["titleTag", "sourceUrls"],
      enrichmentColumns: [titleTag, sourceUrls],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    // One OpenAI attempt plus one SearchApi search.
    expect(billedCostsOf(error)).toHaveLength(2);
  });

  it("leaves PLP sheets on the OpenAI call", async () => {
    const fetchMock = stubBoth({
      openAi: {
        id: "r1",
        status: "completed",
        usage,
        output: [
          { type: "web_search_call", action: { type: "search", query: "x" } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify({ sourceUrls: [], notes: "" }) }] },
        ],
      },
    });
    const plpSourceUrls = getDefaultEnrichmentColumns("plp").find((c) => c.id === "sourceUrls")!;
    await enrichRow({
      ...baseParams,
      kind: "plp",
      enabledColumns: ["sourceUrls"],
      enrichmentColumns: [{ ...plpSourceUrls, enabled: true }],
    });
    expect(callsTo(fetchMock, SEARCHAPI_HOST)).toHaveLength(0);
    expect(callsTo(fetchMock, OPENAI_RESPONSES_URL)).toHaveLength(1);
  });
});

describe("Source URLs website mode", () => {
  const PRODUCT = "https://www.mamasandpapas.com/products/check-jacket-3-6-s07fn6db4";
  const site = {
    rowData: { SKU: "S07FN6DB5", Description: "CHECK JACKET BROWN 6-9M", Barcode: "5063229294815", Size: "6-9M" },
    website: "mamasandpapas.com",
    retryDelayMs: 0,
  };
  const homepageOnly = () => aiModeBody("Here you go: https://www.mamasandpapas.com");
  const searchParams = (fetchMock: { mock: { calls: Array<[string | URL, RequestInit?]> } }, index: number) =>
    new URL(String(fetchMock.mock.calls[index]![0])).searchParams;

  beforeEach(() => {
    process.env.SEARCHAPI_API_KEY = "test-key";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks the short request, sends the market as the location, and keeps the cited product page", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) =>
      new Response(
        aiModeBody("https://www.mamasandpapas.com", [{ link: `${PRODUCT}#:~:text=Check`, title: "Check Jacket" }]),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchSourceUrls({ ...site, location: "United Kingdom" });

    expect(result.sources).toEqual([{ title: "Check Jacket", uri: PRODUCT }]);
    expect(result.attempts).toBe(1);
    expect(result.costs).toHaveLength(1);
    const params = searchParams(fetchMock, 0);
    expect(params.get("location")).toBe("United Kingdom");
    expect(params.get("q")).toBe(
      [
        "mamasandpapas.com product page for this item:",
        "- SKU: S07FN6DB5",
        "- Description: CHECK JACKET BROWN 6-9M",
        "- Barcode: 5063229294815",
        "- Size: 6-9M",
        "Return the mamasandpapas.com product page link only.",
      ].join("\n")
    );
    expect(params.get("q")).not.toMatch(/uk|united kingdom/i);
  });

  it("sends no location when none is chosen, and finds the same page", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) =>
      new Response(aiModeBody(`The page is ${PRODUCT}`, [{ link: PRODUCT }]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls(site);
    expect(result.sources.map((s) => s.uri)).toEqual([PRODUCT]);
    expect(searchParams(fetchMock, 0).has("location")).toBe(false);
  });

  it("never returns the home page: one simpler second search, then 'not found'", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(homepageOnly(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchSourceUrls(site);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(searchParams(fetchMock, 1).get("q")).toBe(
      [
        "mamasandpapas.com product page for this item:",
        "- Description: CHECK JACKET BROWN 6-9M",
        "- Barcode: 5063229294815",
        "Return the mamasandpapas.com product page link only.",
      ].join("\n")
    );
    expect(result.sources).toEqual([]);
    expect(result.attempts).toBe(2);
    expect(result.costs).toHaveLength(2);
    expect(result.notFoundReason).toMatch(/no product page on mamasandpapas\.com/);
    expect(result.notFoundReason).toMatch(/search 1: returned 1 link, none a product page on mamasandpapas\.com \(1 the home page\); search 2:/);
  });

  it("finds the page on the simpler second search", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => {
      calls += 1;
      return new Response(calls === 1 ? homepageOnly() : aiModeBody("", [{ link: PRODUCT, title: "Check Jacket" }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls({ ...site, location: "United Kingdom" });
    expect(result.sources.map((s) => s.uri)).toEqual([PRODUCT]);
    expect(result.attempts).toBe(2);
    // The market applies to the second search too.
    expect(searchParams(fetchMock, 1).get("location")).toBe("United Kingdom");
  });

  it("does not pay for a second search that would ask the same thing", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(homepageOnly(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls({ rowData: { Title: "Check Jacket" }, website: "mamasandpapas.com" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.costs).toHaveLength(1);
    expect(result.sources).toEqual([]);
    expect(result.notFoundReason).toMatch(/\(search 1: returned 1 link/);
  });

  it("rejects a product page on another website", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(aiModeBody("", [{ link: "https://www.argos.co.uk/product/1234567", title: "Argos" }]), { status: 200 }))
    );
    const result = await searchSourceUrls(site);
    expect(result.sources).toEqual([]);
    expect(result.notFoundReason).toMatch(/1 on another website/);
  });

  it("names up to three websites in one search and keeps the page from whichever has it", async () => {
    const mint = "https://www.mintvelvet.co.uk/product/check-coat-123";
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) =>
      new Response(aiModeBody("", [{ link: "https://www.google.com/search?ibp=oshop" }, { link: mint, title: "Check Coat" }]), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchSourceUrls({
      ...site,
      website: "mamasandpapas.com, mintvelvet.co.uk, allbirds.com, extra.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.sources).toEqual([{ title: "Check Coat", uri: mint }]);
    const q = searchParams(fetchMock, 0).get("q")!;
    expect(q.split("\n")[0]).toBe("mamasandpapas.com, mintvelvet.co.uk or allbirds.com product page for this item:");
    expect(q.split("\n").at(-1)).toBe("Return the product page link only, from mamasandpapas.com, mintvelvet.co.uk or allbirds.com.");
    expect(q).not.toContain("extra.com");
  });

  it("sends the photo with the first search only", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => {
      calls += 1;
      return new Response(calls === 1 ? homepageOnly() : aiModeBody("", [{ link: PRODUCT }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ ...site, imageUrl: "https://cdn.example.com/jacket.jpg" });
    expect(searchParams(fetchMock, 0).get("url")).toBe("https://cdn.example.com/jacket.jpg");
    expect(searchParams(fetchMock, 0).get("q")).toContain("The attached photo shows the product.");
    expect(searchParams(fetchMock, 1).has("url")).toBe(false);
  });

  it("leaves the open search alone when no website is set", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(aiModeBody(FOUND_ANSWER), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchSourceUrls({ rowData: row, website: "   " });
    expect(searchParams(fetchMock, 0).get("q")).toBe(buildSourceUrlsQuery({ rowData: row }));
    expect(searchParams(fetchMock, 0).has("location")).toBe(false);
    expect(result.sources).toHaveLength(2);
    expect(result.notFoundReason).toBe("");
  });

  it("still sends a chosen market with the open search", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) => new Response(aiModeBody(FOUND_ANSWER), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSourceUrls({ rowData: row, location: "Germany" });
    expect(searchParams(fetchMock, 0).get("location")).toBe("Germany");
  });

  describe("through the Source URLs column's settings", () => {
    const column = getDefaultEnrichmentColumns("product").find((c) => c.id === "sourceUrls")!;
    const params = (overrides: Partial<typeof column>) => ({
      productData: site.rowData,
      settings: { enrichmentModel: "standard" as const, outputLanguage: "English" },
      kind: "product" as const,
      enabledColumns: ["sourceUrls"],
      enrichmentColumns: [{ ...column, enabled: true, ...overrides }],
    });
    const stub = () => {
      const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) =>
        new Response(aiModeBody("", [{ link: PRODUCT, title: "Check Jacket" }]), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    it("uses the column's website and chosen market, and skips the default instruction", async () => {
      const fetchMock = stub();
      const result = await enrichRow(params({ sourceWebsite: "https://www.MamasAndPapas.com/products/x", sourceMarket: "gb" }));
      const q = searchParams(fetchMock, 0);
      expect(q.get("location")).toBe("United Kingdom");
      expect(q.get("q")).toMatch(/^mamasandpapas\.com product page for this item:\n- SKU: S07FN6DB5\n- Description: CHECK JACKET/);
      expect(q.get("q")).not.toContain("manufacturer");
      expect(result.data.sourceUrls).toEqual([{ title: "Check Jacket", uri: PRODUCT }]);
    });

    it("Auto takes the country from the website ending, and stays unset for .com", async () => {
      const uk = stub();
      await enrichRow(params({ sourceWebsite: "mamasandpapas.co.uk" }));
      expect(searchParams(uk, 0).get("location")).toBe("United Kingdom");

      const global = stub();
      await enrichRow(params({ sourceWebsite: "mamasandpapas.com", sourceMarket: "auto" }));
      expect(searchParams(global, 0).has("location")).toBe(false);
    });

    it("Any country overrides Auto", async () => {
      const fetchMock = stub();
      await enrichRow(params({ sourceWebsite: "mamasandpapas.co.uk", sourceMarket: "none" }));
      expect(searchParams(fetchMock, 0).has("location")).toBe(false);
    });

    it("treats a website that is not a website as the open search, and an unknown market as none", async () => {
      const fetchMock = stub();
      await enrichRow(params({ sourceWebsite: "not a website", sourceMarket: "narnia" }));
      expect(searchParams(fetchMock, 0).get("q")).toContain("Find every web page that sells this exact product");
      expect(searchParams(fetchMock, 0).has("location")).toBe(false);
    });

    it("keeps the owner's own short note in website mode", async () => {
      const fetchMock = stub();
      await enrichRow(params({ sourceWebsite: "mamasandpapas.com", customInstruction: "Prefer the brown one." }));
      expect(searchParams(fetchMock, 0).get("q")).toMatch(/\nNote: Prefer the brown one\.$/);
    });
  });
});
