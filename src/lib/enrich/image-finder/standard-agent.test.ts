import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The image load check refuses hosts that are private or do not resolve, which
// needs a real DNS lookup. These tests use made-up shop hosts, so keep the real
// rules for host names and addresses but skip the lookup.
vi.mock("@/lib/net/public-host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/net/public-host")>();
  return {
    ...actual,
    isPublicHttpUrl: async (url: URL) =>
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !actual.isBlockedHostname(url.hostname),
  };
});

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

  it("explains a found item whose images could not be confirmed, and which check dropped them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(oneShotResponse({ status: "found", images: [image(FRONT)], notes: "Shop Test" }, []));
    const result = await enrichRow(params);
    expect(result.data.imageUrls).toEqual([]);
    expect(String(result.data[notFoundKey])).toContain("could not be confirmed");
    expect(String(result.data[notFoundKey])).toContain("1 returned: 1 from a page that was not opened during the search");
    expect(result.data[matchBasisKey]).toBe("");
  });

  describe("image links in any shape", () => {
    // Shops (SAP Commerce / Hybris, CMS media endpoints) serve pictures from addresses with no extension.
    const TOYSRUS_PAGE = "https://www.toysrus.es/Motor-y-Co-Dinosaurio-R-C-interactivo/p/K1048394";
    const TOYSRUS_IMAGE =
      "https://www.toysrus.es/medias/?context=bWFzdGVyfHByb2R1Y3RfaW1hZ2VzfDE5MDE2fGltYWdlL2pwZWd8YURJNUwyZzJZeTh4TWpnNE1URXpOVFF3TXpBek9BfDE4NmY2YzY0MTBlMTg1ZDY2OGNmYTFlMTVkODMzY2MxMGY4NzIyZDQ4NzhjZDljYWUzNDczYTkxNTA1NGM2MDY";
    const MEDIAS = "https://shop.test/medias/?context=bWFzdGVyfHByb2R1Y3RfaW1hZ2Vz";
    const ODD = "https://shop.test/zz/?context=abc123";
    const PAGE_LIKE = "https://shop.test/gallery.html";

    function stubOddFetch(body: unknown, statusFor: (url: string) => number) {
      const fetchMock = vi.fn(async (...[input]: [string | URL, RequestInit?]) => {
        const url = String(input);
        if (url === OPENAI_RESPONSES_URL) return new Response(JSON.stringify(body), { status: 200 });
        const status = statusFor(url);
        return status === 200
          ? new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200, headers: { "content-type": "image/jpeg" } })
          : new Response(null, { status });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("keeps the Toys“R”Us /medias/?context= gallery the agent returned, even when our server is refused", async () => {
      stubOddFetch(
        oneShotResponse(
          { status: "found", images: [image(TOYSRUS_IMAGE, TOYSRUS_PAGE)], notes: "Opened the Toys“R”Us page." },
          [TOYSRUS_PAGE]
        ),
        () => 403
      );
      const result = await enrichRow(params);
      expect(imageUrlsOf(result.data)).toEqual([TOYSRUS_IMAGE]);
      expect(result.data[notFoundKey]).toBe("");
      expect(String(result.data[matchNoteKey])).toContain("could not be load-checked");
    });

    it("keeps images from a known Source URLs page even when open_page is missing from the tool log", async () => {
      stubOddFetch(
        oneShotResponse(
          { status: "found", images: [image(TOYSRUS_IMAGE, TOYSRUS_PAGE)], notes: "" },
          []
        ),
        () => 200
      );
      const result = await enrichRow({ ...params, knownPages: [{ url: TOYSRUS_PAGE, title: "Dinosaurio R/C" }] });
      expect(imageUrlsOf(result.data)).toEqual([TOYSRUS_IMAGE]);
      expect(result.data[notFoundKey]).toBe("");
    });

    it("keeps a link with no extension that loads as an image (the /medias/?context= shape)", async () => {
      stubOddFetch(oneShotResponse({ status: "found", images: [image(MEDIAS), image(ODD)], notes: "" }), () => 200);
      const result = await enrichRow(params);
      expect(imageUrlsOf(result.data)).toEqual([MEDIAS, ODD]);
      expect(result.data[notFoundKey]).toBe("");
    });

    it("keeps such a link even when our server is refused, because its page was opened", async () => {
      stubOddFetch(oneShotResponse({ status: "found", images: [image(ODD)], notes: "" }), () => 403);
      const result = await enrichRow(params);
      expect(imageUrlsOf(result.data)).toEqual([ODD]);
      expect(String(result.data[matchNoteKey])).toContain("could not be load-checked");
    });

    it("keeps a page-like link only when it was confirmed to load as an image", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      stubOddFetch(oneShotResponse({ status: "found", images: [image(PAGE_LIKE)], notes: "" }), () => 403);
      const refused = await enrichRow(params);
      expect(refused.data.imageUrls).toEqual([]);
      expect(String(refused.data[notFoundKey])).toContain("1 did not load as an image");

      stubOddFetch(oneShotResponse({ status: "found", images: [image(PAGE_LIKE)], notes: "" }), () => 200);
      const confirmed = await enrichRow(params);
      expect(imageUrlsOf(confirmed.data)).toEqual([PAGE_LIKE]);
    });

    it("drops the product page itself, and says it was not an image link", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      stubFetch(oneShotResponse({ status: "found", images: [image(PAGE)], notes: "" }));
      const result = await enrichRow(params);
      expect(result.data.imageUrls).toEqual([]);
      expect(String(result.data[notFoundKey])).toContain("1 returned: 1 not an image link");
      expect(warn).toHaveBeenCalledWith(
        "[Image Finder] The agent found the item but no image was kept",
        expect.objectContaining({ returned: 1, notAnImageLink: 1 })
      );
    });
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
