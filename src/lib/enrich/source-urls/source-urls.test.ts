import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultEnrichmentColumns } from "@/types";
import { enrichRow } from "../agent";
import { billedCostsOf, OPENAI_RESPONSES_URL } from "../openai";
import { usesGoogleSourceUrls } from "./agent";
import { looksLikeListingPage, pageKey, rankSources, searchSourceUrls } from "./search";
import {
  buildSourceUrlsQuery,
  cleanPageTitle,
  harvestSourceCandidates,
  parseBestSourceAnswer,
  parseSourceUrlsAnswer,
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
  it("carries the product, the custom instruction and the output format", () => {
    const query = buildSourceUrlsQuery({
      rowData: row,
      rowIdentifiers: ["WX-1"],
      customInstruction: "Prefer the manufacturer's own site.",
      maxSources: 3,
    });
    expect(query).toContain("- Title: Widget WX-1");
    expect(query).toContain("identified by: WX-1");
    expect(query).toContain("Prefer the manufacturer's own site.");
    expect(query).toContain("UP TO 3");
    expect(query).toContain('"sources":[');
  });

  it("mentions the photo only when one is sent", () => {
    const base = { rowData: row, rowIdentifiers: [], maxSources: 3 };
    expect(buildSourceUrlsQuery({ ...base, hasImage: true })).toContain("A photo of the item is attached");
    expect(buildSourceUrlsQuery(base)).not.toContain("A photo of the item is attached");
  });

  it("says 'None given.' without a custom instruction and uses new angles on attempt 2", () => {
    const base = { rowData: row, rowIdentifiers: [], maxSources: 3 };
    expect(buildSourceUrlsQuery(base)).toContain("None given.");
    expect(buildSourceUrlsQuery({ ...base, attempt: 2 })).toContain("beyond the obvious ones");
  });

  it("never lets the fields push the steps and output format out of the query", () => {
    const rowData = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Field ${i}`, "x".repeat(300)]));
    const query = buildSourceUrlsQuery({ rowData, rowIdentifiers: [], maxSources: 10, customInstruction: "y".repeat(5000) });
    expect(query.length).toBeLessThanOrEqual(8_000);
    expect(query).toContain("OUTPUT FORMAT");
    expect(query).toContain("Maximum 10 sources");
  });

  it("leaves image attachments and image links out of the product fields", () => {
    const query = buildSourceUrlsQuery({
      rowData: { Title: "Widget", Photos: "[3 images attached]", Img: "https://cdn.example.com/a.jpg" },
      rowIdentifiers: [],
      maxSources: 3,
    });
    expect(query).toContain("- Title: Widget");
    expect(query).not.toContain("Photos");
    expect(query).not.toContain("cdn.example.com");
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
    expect(looksLikeListingPage("https://www.amazon.com/dp/B0CP9Z1S51")).toBe(false);
    expect(looksLikeListingPage("https://shop.example.com/products/widget-wx-1")).toBe(false);
  });

  it("puts pages Google itself cited first, with Google's title, and respects the limit", () => {
    const ranked = rankSources(
      [
        { url: "https://a.example.com/p/1", title: "A" },
        { url: "https://b.example.com/p/2", title: "B" },
        { url: "https://c.example.com/p/3", title: "C" },
      ],
      [{ link: "https://b.example.com/p/2#:~:text=x", title: "B from Google" }],
      3
    );
    expect(ranked).toEqual([{ title: "B from Google", uri: "https://b.example.com/p/2" }]);
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

  const input = { rowData: row, rowIdentifiers: ["WX-1"], maxSources: 3 };

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
    expect(called.searchParams.get("q")).toContain("A photo of the item is attached");
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
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get("q")).not.toContain("A photo of the item is attached");
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
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get("q")).toContain("beyond the obvious ones");
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
    const result = await searchSourceUrls(input);
    expect(result.sources).toEqual([]);
    expect(result.costs).toHaveLength(1);
    expect(result.notFoundReason).toMatch(/search 2 failed/);
  });

  it("throws when the first search fails (nothing was billed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(searchSourceUrls(input)).rejects.toThrow(/failed \(500\)/);
  });

  it("enforces the store owner's website rules on what it returns", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(aiModeBody(FOUND_ANSWER), { status: 200 })));
    const result = await searchSourceUrls({
      ...input,
      domainRules: { allowedDomains: ["acme.com"], blockedDomains: [] },
    });
    expect(result.sources.map((s) => s.uri)).toEqual(["https://www.acme.com/products/widget-wx-1"]);
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
    stubBoth({ googleStatus: 500, googleBody: "boom" });
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
    stubBoth({ googleStatus: 500, googleBody: "boom" });
    await expect(
      enrichRow({ ...baseParams, enabledColumns: ["sourceUrls"], enrichmentColumns: [sourceUrls] })
    ).rejects.toThrow(/failed \(500\)/);
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
