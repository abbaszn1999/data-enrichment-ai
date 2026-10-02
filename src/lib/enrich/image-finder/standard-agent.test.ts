import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The single agent call on its own; the wrapper around it is covered by agent.test.ts.
const { findProductImagesStandard: enrichRow } = await import("./standard-agent");
const { OPENAI_RESPONSES_URL } = await import("../openai");
const { imageFinderMatchBasisKey, imageFinderMatchNoteKey, imageFinderNotFoundKey } = await import("./not-found");
const { IMAGE_FINDER_STANDARD_SKILL } = await import("./standard-skill");
const { STANDARD_MATCH_BASIS, STANDARD_MATCH_NOTE } = await import("./standard-agent");

const notFoundKey = imageFinderNotFoundKey("imageUrls");
const matchBasisKey = imageFinderMatchBasisKey("imageUrls");
const matchNoteKey = imageFinderMatchNoteKey("imageUrls");
const usage = { input_tokens: 3_000, input_tokens_details: { cached_tokens: 1_000 }, output_tokens: 800 };
const PAGE = "https://shop.test/products/electric-ride-on-bulldozer";
const FRONT = "https://shop.test/cdn/files/dozer-front.jpg?v=1&width=1080";
const SIDE = "https://shop.test/cdn/files/dozer-side.jpg?v=1&width=1080";
const BLOCKED_PAGE = "https://blocked.test/p/dozer";
const BLOCKED_IMAGE = "https://blocked.test/img/dozer.jpg";

function oneShotResponse(answer: Record<string, unknown>, openedPages: string[] = [PAGE]) {
  return {
    id: "resp_1",
    status: "completed",
    usage,
    output: [
      { type: "web_search_call", action: { type: "search", query: "RCP1151426" } },
      ...openedPages.map((url) => ({ type: "web_search_call", action: { type: "open_page", url } })),
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] },
    ],
  };
}

const image = (url: string, pageUrl = PAGE) => ({ url, pageUrl });

function stubFetch(body: unknown, deadImages: string[] = []) {
  const fetchMock = vi.fn(async (...[input]: [string | URL, RequestInit?]) => {
    const url = String(input);
    if (url === OPENAI_RESPONSES_URL) return new Response(JSON.stringify(body), { status: 200 });
    if (deadImages.includes(url)) return new Response(null, { status: 404 });
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function openAiRequests(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]) === OPENAI_RESPONSES_URL)
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

const imageUrlsOf = (data: Record<string, unknown>) =>
  (data.imageUrls as Array<{ imageUrl: string }>).map((entry) => entry.imageUrl);

const column = {
  id: "imageUrls",
  label: "Image URLs",
  description: "",
  type: "imageUrls" as const,
  enabled: true,
  customInstruction: "White background first",
};

const params = {
  productData: { Code: "RCP1151426", Description: "2.4G RC ENGINEERING VEHICLE (YELLOW)", Brand: "PAKTAT" },
  enabledColumns: ["imageUrls"],
  enrichmentColumns: [column],
  settings: { enrichmentModel: "standard" as const, outputLanguage: "English" },
  kind: "product" as const,
};

describe("Image Finder agent (one call)", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends exactly one request with web_search only, the skill and the Image Finder model and effort", async () => {
    const fetchMock = stubFetch(
      oneShotResponse({ status: "found", images: [image(FRONT), image(SIDE)], notes: "Shop Test, SKU RCP1151426" })
    );
    const result = await enrichRow(params);

    const requests = openAiRequests(fetchMock);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.instructions).toBe(IMAGE_FINDER_STANDARD_SKILL);
    expect(request.model).toBe("gpt-6.1-sol");
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0].type).toBe("web_search");
    expect(request.tools[0].search_content_types).toEqual(["text"]);
    expect(request.text.format.name).toBe("catalog_image_finder_standard");

    const prompt = request.input[0].content.at(-1).text as string;
    expect(prompt).toContain("RCP1151426");
    expect(prompt).toContain("## Custom instruction (store owner, highest priority)\nWhite background first");
    expect(prompt).not.toContain("check_pages");
    expect(prompt).not.toContain("matchBasis");

    expect(result.data.imageUrls).toEqual([
      { imageUrl: FRONT, pageUrl: PAGE, title: `${STANDARD_MATCH_NOTE} Product image` },
      { imageUrl: SIDE, pageUrl: PAGE, title: `${STANDARD_MATCH_NOTE} Product image` },
    ]);
    expect(result.data[matchBasisKey]).toBe(STANDARD_MATCH_BASIS);
    expect(result.data[matchNoteKey]).toBe(STANDARD_MATCH_NOTE);
    expect(result.data[notFoundKey]).toBe("");
    expect(result.costs).toHaveLength(1);
  });

  it("keeps only images from a page web_search really opened, and only direct image links", async () => {
    stubFetch(
      oneShotResponse({
        status: "found",
        images: [
          image(FRONT),
          image("https://other.test/files/similar.jpg", "https://other.test/p/never-opened"),
          image(PAGE),
        ],
        notes: "",
      })
    );
    const result = await enrichRow(params);
    expect(imageUrlsOf(result.data)).toEqual([FRONT]);
  });

  it("matches the opened page ignoring query strings, www and trailing slashes", async () => {
    stubFetch(
      oneShotResponse({ status: "found", images: [image(FRONT, "https://www.shop.test/products/electric-ride-on-bulldozer/")], notes: "" }, [
        `${PAGE}?variant=1`,
      ])
    );
    const result = await enrichRow(params);
    expect(imageUrlsOf(result.data)).toEqual([FRONT]);
  });

  it("drops duplicate and non-loading images", async () => {
    stubFetch(oneShotResponse({ status: "found", images: [image(FRONT), image(FRONT), image(SIDE)], notes: "" }), [SIDE]);
    const result = await enrichRow(params);
    expect(imageUrlsOf(result.data)).toEqual([FRONT]);
  });

  it("records the agent's reason and no match label when nothing is found", async () => {
    stubFetch(
      oneShotResponse({ status: "not_found", images: [], notes: "Searched the code and the brand site; no page shows RCP1151426." })
    );
    const result = await enrichRow(params);
    expect(result.data).toEqual({
      imageUrls: [],
      [notFoundKey]: "Searched the code and the brand site; no page shows RCP1151426.",
      [matchBasisKey]: "",
      [matchNoteKey]: "",
    });
  });

  it("shows the agent's citations as plain text in the Not found reason", async () => {
    stubFetch(
      oneShotResponse({
        status: "not_found",
        images: [],
        notes: "Opened the lead; it returned 403. ([]()) Rejected the page ([shop.test](https://shop.test/p/x)).",
      })
    );
    const result = await enrichRow(params);
    expect(result.data[notFoundKey]).toBe("Opened the lead; it returned 403. Rejected the page (shop.test).");
  });

  it("ignores images when the agent says not found", async () => {
    stubFetch(oneShotResponse({ status: "not_found", images: [image(FRONT)], notes: "Only a similar item." }));
    const result = await enrichRow(params);
    expect(result.data.imageUrls).toEqual([]);
  });

  it("explains a found item whose images could not be confirmed", async () => {
    stubFetch(oneShotResponse({ status: "found", images: [image(FRONT)], notes: "Shop Test" }, []));
    const result = await enrichRow(params);
    expect(result.data.imageUrls).toEqual([]);
    expect(String(result.data[notFoundKey])).toContain("could not be confirmed");
    expect(result.data[matchBasisKey]).toBe("");
  });

  it("puts known pages from a Source URLs column into the prompt, filtered by the website rules", async () => {
    const fetchMock = stubFetch(oneShotResponse({ status: "found", images: [image(FRONT)], notes: "" }));
    const result = await enrichRow({
      ...params,
      enrichmentColumns: [{ ...column, blockedDomains: ["blocked.test"] }],
      knownPages: [
        { url: PAGE, title: "Electric Ride-on Bulldozer" },
        { url: BLOCKED_PAGE, title: "Blocked seller" },
      ],
    });
    const prompt = openAiRequests(fetchMock)[0].input[0].content.at(-1).text as string;
    expect(prompt).toContain("## Known pages for this item");
    expect(prompt).toContain(`- Electric Ride-on Bulldozer (${PAGE})`);
    expect(prompt).not.toContain(BLOCKED_PAGE);
    expect(imageUrlsOf(result.data)).toEqual([FRONT]);
  });

  it("adds the re-check hint to the prompt on a re-check", async () => {
    const fetchMock = stubFetch(oneShotResponse({ status: "not_found", images: [], notes: "none" }));
    await enrichRow({ ...params, recheck: true });
    const prompt = openAiRequests(fetchMock)[0].input[0].content.at(-1).text as string;
    expect(prompt).toContain("## Final re-check");
  });

  it("applies website rules to the search and to the returned images", async () => {
    const fetchMock = stubFetch(
      oneShotResponse(
        { status: "found", images: [image(BLOCKED_IMAGE, BLOCKED_PAGE), image(FRONT)], notes: "" },
        [BLOCKED_PAGE, PAGE]
      )
    );
    const result = await enrichRow({
      ...params,
      enrichmentColumns: [{ ...column, blockedDomains: ["blocked.test"] }],
    });
    expect(openAiRequests(fetchMock)[0].tools[0].filters).toEqual({ blocked_domains: ["blocked.test"] });
    expect(imageUrlsOf(result.data)).toEqual([FRONT]);
  });
});
