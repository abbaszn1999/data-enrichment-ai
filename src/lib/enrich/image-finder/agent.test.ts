import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const { enrichRow } = await import("../agent");
const { OPENAI_RESPONSES_URL } = await import("../openai");
const { imageFinderMatchBasisKey, imageFinderMatchNoteKey, imageFinderNotFoundKey } = await import("./not-found");
const { IMAGE_FINDER_SKILL } = await import("./skill");
const { resetFetchPageStateForTests } = await import("./tools/fetch-page");
const { IMAGE_FINDER_MAX_ROUNDS, IMAGE_FINDER_MAX_ROUNDS_STANDARD } = await import("./agent");

const notFoundKey = imageFinderNotFoundKey("imageUrls");
const matchBasisKey = imageFinderMatchBasisKey("imageUrls");
const matchNoteKey = imageFinderMatchNoteKey("imageUrls");
const usage = { input_tokens: 3_000, input_tokens_details: { cached_tokens: 1_000 }, output_tokens: 800 };
const PAGE = "https://shop.test/products/electric-ride-on-bulldozer";
const FRONT = "https://cdn.imagehost.test/files/dozer-front-20260108.jpg";
const SIDE = "https://cdn.imagehost.test/files/dozer-side-20260108.jpg";

function productHtml(sku: string | null) {
  const ld = {
    "@type": "Product",
    name: "Electric Ride-On Bulldozer",
    ...(sku ? { sku } : {}),
    image: [FRONT, SIDE],
  };
  return `<html><head><title>Electric Ride-On Bulldozer</title>
<script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body><h1>Electric Ride-On Bulldozer</h1><form action="/search" method="get"><input type="search" name="q"></form></body></html>`;
}

function fetchPageCall(url: string, id = "resp_1") {
  return {
    id,
    status: "completed",
    usage,
    output: [
      { type: "web_search_call", action: { type: "search", query: "RCP1151426" } },
      { type: "function_call", call_id: `call_${id}`, name: "fetch_page", arguments: JSON.stringify({ url }) },
    ],
  };
}

function finalAnswer(answer: Record<string, unknown>) {
  return {
    id: "resp_final",
    status: "completed",
    usage,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
  };
}

function found(images: Array<{ url: string; pageUrl?: string }>, notes = "Verified SKU on the product page") {
  return {
    status: "found",
    verification: { pageUrl: PAGE, identifierSeen: "RCP1151426", matchBasis: "identifier" },
    images: images.map((image) => ({ url: image.url, pageUrl: image.pageUrl ?? PAGE })),
    notes,
  };
}

function stubFetch(openAiBodies: unknown[], pages: Record<string, string>) {
  let openAiIndex = 0;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === OPENAI_RESPONSES_URL) {
      const body = openAiBodies[Math.min(openAiIndex, openAiBodies.length - 1)];
      openAiIndex += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (pages[url] !== undefined) {
      return new Response(pages[url], { status: 200, headers: { "content-type": "text/html" } });
    }
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) {
      return new Response(init?.method === "HEAD" ? null : new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function openAiRequests(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]) === OPENAI_RESPONSES_URL)
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

const params = {
  productData: { Code: "RCP1151426", Description: "2.4G RC ENGINEERING VEHICLE (YELLOW)", Brand: "PAKTAT" },
  enabledColumns: ["imageUrls"],
  enrichmentColumns: [
    {
      id: "imageUrls",
      label: "Image URLs",
      description: "",
      type: "imageUrls" as const,
      enabled: true,
      imageCount: 3,
      customInstruction: "White background first",
    },
  ],
  settings: { enrichmentModel: "standard" as const, outputLanguage: "English" },
  kind: "product" as const,
};

describe("Image Finder agent v2", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    resetFetchPageStateForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs the research loop with the trial model, tools and brief, and bills every round", async () => {
    const fetchMock = stubFetch(
      [fetchPageCall(PAGE), finalAnswer(found([{ url: FRONT }, { url: SIDE }]))],
      { [PAGE]: productHtml("RCP1151426") }
    );

    const result = await enrichRow(params);

    const [first, second] = openAiRequests(fetchMock);
    expect(first.model).toBe("gpt-5.6-sol");
    expect(first.reasoning).toEqual({ effort: "high" });
    expect(first.instructions).toBe(IMAGE_FINDER_SKILL);
    expect(first.tools.map((t: { type: string; name?: string }) => t.name ?? t.type)).toEqual([
      "web_search",
      "check_pages",
      "fetch_page",
      "view_images",
    ]);
    const schema = first.text.format.schema;
    expect(schema.properties.verification.required).toContain("brandSeen");
    expect(schema.properties.verification.properties.matchBasis.enum).toEqual([
      "identifier",
      "near_identifier",
      "model_variant",
      "best_match",
      "none",
    ]);
    expect(first.tools[0].search_content_types).toEqual(["text"]);
    const prompt = first.input[0].content.at(-1).text as string;
    expect(prompt).toContain("## Row identifiers");
    expect(prompt).toContain("RCP1151426");
    expect(prompt).toContain("## Custom instruction (store owner, highest priority)\nWhite background first");

    expect(second.previous_response_id).toBe("resp_1");
    const toolOutput = JSON.parse(second.input[0].output);
    expect(toolOutput.rowIdentifiersSeen).toContain("RCP1151426");
    expect(toolOutput.searchForms[0].urlTemplate).toBe("https://shop.test/search?q={query}");

    expect(result.data).toEqual({
      imageUrls: [
        expect.objectContaining({ imageUrl: FRONT, pageUrl: PAGE, title: "Product image" }),
        expect.objectContaining({ imageUrl: SIDE, pageUrl: PAGE }),
      ],
      [notFoundKey]: "",
      [matchBasisKey]: "identifier",
      [matchNoteKey]: "",
    });
    expect(result.costs).toHaveLength(2);
  });

  it("drops an image link that never appeared on a verified page", async () => {
    stubFetch(
      [
        fetchPageCall(PAGE),
        finalAnswer(found([{ url: FRONT }, { url: "https://cdn.imagehost.test/files/similar-item-99999999.jpg" }])),
      ],
      { [PAGE]: productHtml("RCP1151426") }
    );
    const result = await enrichRow(params);
    const images = result.data.imageUrls as Array<{ imageUrl: string }>;
    expect(images.map((image) => image.imageUrl)).toEqual([FRONT]);
  });

  it("rejects a match on a page the agent never actually opened", async () => {
    stubFetch([finalAnswer(found([{ url: FRONT }]))], {});
    const result = await enrichRow(params);
    expect(result.data.imageUrls).toEqual([]);
    expect(String(result.data[notFoundKey])).toContain("was not opened successfully");
  });

  it("rejects a page that does not show any of the row's identifiers", async () => {
    stubFetch([fetchPageCall(PAGE), finalAnswer(found([{ url: FRONT }]))], { [PAGE]: productHtml(null) });
    const result = await enrichRow(params);
    expect(result.data.imageUrls).toEqual([]);
    expect(String(result.data[notFoundKey])).toContain("None of this row's identifiers appear");
  });

  it("keeps CDN-hosted images when the verified page is on an allowed website", async () => {
    const fetchMock = stubFetch(
      [fetchPageCall(PAGE), finalAnswer(found([{ url: FRONT }]))],
      { [PAGE]: productHtml("RCP1151426") }
    );
    const result = await enrichRow({
      ...params,
      enrichmentColumns: [{ ...params.enrichmentColumns[0], allowedDomains: ["shop.test"] }],
    });
    expect(openAiRequests(fetchMock)[0].tools[0].filters).toEqual({ allowed_domains: ["shop.test"] });
    expect((result.data.imageUrls as unknown[]).length).toBe(1);
  });

  it("refuses to open pages outside the allowed websites", async () => {
    const fetchMock = stubFetch(
      [fetchPageCall("https://other.test/products/x"), finalAnswer({ ...found([]), status: "not_found" })],
      {}
    );
    await enrichRow({
      ...params,
      enrichmentColumns: [{ ...params.enrichmentColumns[0], allowedDomains: ["shop.test"] }],
    });
    const toolOutput = JSON.parse(openAiRequests(fetchMock)[1].input[0].output);
    expect(toolOutput.error).toContain("outside the store owner's allowed websites");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith("https://other.test"))).toBe(false);
  });

  it("records the agent's own reason when it finds nothing, and clears it on success", async () => {
    stubFetch(
      [
        finalAnswer({
          status: "not_found",
          verification: { pageUrl: "", identifierSeen: "", matchBasis: "none" },
          images: [],
          notes: "Searched the code, the brand site and three retailers; no page shows RCP1151426.",
        }),
      ],
      {}
    );
    const miss = await enrichRow(params);
    expect(miss.data).toEqual({
      imageUrls: [],
      [notFoundKey]: "Searched the code, the brand site and three retailers; no page shows RCP1151426.",
      [matchBasisKey]: "",
      [matchNoteKey]: "",
    });

    resetFetchPageStateForTests();
    stubFetch([fetchPageCall(PAGE), finalAnswer(found([{ url: FRONT }]))], { [PAGE]: productHtml("RCP1151426") });
    const hit = await enrichRow(params);
    expect(hit.data[notFoundKey]).toBe("");
  });

  it("passes sheet-learned websites and the re-check hint into the brief", async () => {
    const fetchMock = stubFetch([finalAnswer({ ...found([]), status: "not_found" })], {});
    await enrichRow({ ...params, learnedDomains: ["shop.test"], recheck: true });
    const prompt = openAiRequests(fetchMock)[0].input[0].content.at(-1).text as string;
    expect(prompt).toContain("## Websites where other products of this sheet were verified\nshop.test");
    expect(prompt).toContain("## Final re-check");
  });

  it("labels a code-less row's verified item as a best match and writes the note on captions", async () => {
    const brandedHtml = productHtml(null).replace('"name":"Electric Ride-On Bulldozer"', '"name":"Electric Ride-On Bulldozer","brand":{"name":"Paktat"}');
    const fetchMock = stubFetch(
      [
        fetchPageCall(PAGE),
        finalAnswer({
          status: "found",
          verification: { pageUrl: PAGE, identifierSeen: "", brandSeen: "Paktat", matchBasis: "best_match" },
          images: [{ url: FRONT, pageUrl: PAGE }],
          notes: "Brand and title match",
        }),
      ],
      { [PAGE]: brandedHtml }
    );
    const result = await enrichRow({
      ...params,
      productData: { Description: "Electric ride-on bulldozer", Brand: "PAKTAT" },
    });
    const prompt = openAiRequests(fetchMock)[0].input[0].content.at(-1).text as string;
    expect(prompt).toContain("None: this row has no SKU, barcode or model code");
    expect(result.data[matchBasisKey]).toBe("best_match");
    expect(result.data[matchNoteKey]).toBe("Best match by title and brand (no code in the sheet).");
    expect(result.data.imageUrls).toEqual([
      expect.objectContaining({ imageUrl: FRONT, title: "Best match by title and brand (no code in the sheet). Product image" }),
    ]);
  });

  it("leaves mixed column runs on the generic enrichment prompt", async () => {
    const fetchMock = stubFetch(
      [finalAnswer({ imageUrls: [], enhancedTitle: "Widget", notes: "" })],
      {}
    );
    await enrichRow({ ...params, enabledColumns: ["imageUrls", "enhancedTitle"] });
    const request = openAiRequests(fetchMock)[0];
    expect(request.instructions).toBeUndefined();
    expect(request.text.format.name).not.toBe("catalog_image_finder");
  });

  describe("Standard vs Premium round budget", () => {
    /**
     * A model that never stops calling tools on its own: it keeps issuing
     * fetch_page until the loop forces `tool_choice: "none"`, at which point
     * it must answer. Counting requests this way exercises the real
     * round-cap logic in openai.ts rather than asserting the constant
     * directly, so it fails if the tier selection in agent.ts breaks.
     */
    function infiniteRoundsStubFetch() {
      let n = 0;
      const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === OPENAI_RESPONSES_URL) {
          const body = JSON.parse(String(init?.body)) as { tool_choice?: string };
          n += 1;
          if (body.tool_choice === "none") {
            return new Response(
              JSON.stringify(finalAnswer({ ...found([]), status: "not_found" })),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify(fetchPageCall(PAGE, `resp_${n}`)), { status: 200 });
        }
        if (url === PAGE) {
          return new Response(productHtml("RCP1151426"), { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("gives Standard a smaller round budget than Premium, same model and effort", async () => {
      const standardFetch = infiniteRoundsStubFetch();
      await enrichRow({ ...params, settings: { ...params.settings, enrichmentModel: "standard" } });
      const standardRequests = openAiRequests(standardFetch);
      expect(standardRequests).toHaveLength(IMAGE_FINDER_MAX_ROUNDS_STANDARD + 1);
      expect(standardRequests.at(-1).tool_choice).toBe("none");
      expect(standardRequests[0].model).toBe("gpt-5.6-sol");
      expect(standardRequests[0].reasoning).toEqual({ effort: "high" });

      vi.unstubAllGlobals();
      resetFetchPageStateForTests();

      const premiumFetch = infiniteRoundsStubFetch();
      await enrichRow({ ...params, settings: { ...params.settings, enrichmentModel: "premium" } });
      const premiumRequests = openAiRequests(premiumFetch);
      expect(premiumRequests).toHaveLength(IMAGE_FINDER_MAX_ROUNDS + 1);
      expect(premiumRequests.at(-1).tool_choice).toBe("none");
      expect(premiumRequests[0].model).toBe("gpt-5.6-sol");
      expect(premiumRequests[0].reasoning).toEqual({ effort: "high" });
    });
  });
});
