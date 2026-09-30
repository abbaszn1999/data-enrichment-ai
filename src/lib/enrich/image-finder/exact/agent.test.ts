import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Exact tier on its own; the automatic chain around it is covered by pipeline.test.ts.
const { findProductImagesExact: enrichRow } = await import("./agent");
const { OPENAI_RESPONSES_URL } = await import("../../openai");
const { imageFinderMatchBasisKey, imageFinderMatchNoteKey, imageFinderNotFoundKey } = await import("../not-found");
const { IMAGE_FINDER_EXACT_IMAGES_SKILL } = await import("./images-skill");
const { EXACT_MATCH_BASIS, EXACT_MATCH_NOTE } = await import("./agent");
const { SEARCHAPI_BASE } = await import("./searchapi");

const notFoundKey = imageFinderNotFoundKey("imageUrls");
const matchBasisKey = imageFinderMatchBasisKey("imageUrls");
const matchNoteKey = imageFinderMatchNoteKey("imageUrls");
const usage = { input_tokens: 3_000, input_tokens_details: { cached_tokens: 1_000 }, output_tokens: 800 };

const KNOWN_LINK = "https://haierlebanon.test/product/haier-hrf-570wh";
const PAGE = KNOWN_LINK;
const FRONT = "https://haierlebanon.test/cdn/hrf-570wh-front.jpg";
// A percent-encoded path segment that must be decoded before it loads (the Maxx Group case from testing).
const ENCODED_IMAGE = "https://cdn.test/fit-in/1200x1200/filters%3Aformat%28avif%29/a1w30458.jpg";
const DECODED_IMAGE = "https://cdn.test/fit-in/1200x1200/filters:format(avif)/a1w30458.jpg";

function searchApiResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function matchesFound(matches: Array<Record<string, unknown>>) {
  return searchApiResponse({ markdown: JSON.stringify({ result: "MATCHES_FOUND", matches }) });
}

function noExactMatch() {
  return searchApiResponse({ markdown: JSON.stringify({ result: "NO_EXACT_MATCH", matches: [] }) });
}

function oneShotResponse(answer: Record<string, unknown>, openedPages: string[] = [PAGE]) {
  return {
    id: "resp_1",
    status: "completed",
    usage,
    output: [
      { type: "web_search_call", action: { type: "search", query: "HRF-570WH" } },
      ...openedPages.map((url) => ({ type: "web_search_call", action: { type: "open_page", url } })),
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] },
    ],
  };
}

const image = (url: string, pageUrl = PAGE, source: "known" | "new" = "known") => ({ url, pageUrl, source });

function stubFetch(input: {
  searchApi: () => Response;
  openAi?: Record<string, unknown> | (() => Response);
  deadImages?: string[];
}) {
  const fetchMock = vi.fn(async (...[requestInput]: [string | URL, RequestInit?]) => {
    const url = String(requestInput);
    if (url.startsWith(SEARCHAPI_BASE)) return input.searchApi();
    if (url === OPENAI_RESPONSES_URL) {
      if (!input.openAi) throw new Error("Agent 2 (OpenAI) was called but no response was stubbed");
      return typeof input.openAi === "function"
        ? input.openAi()
        : new Response(JSON.stringify(input.openAi), { status: 200 });
    }
    if (input.deadImages?.includes(url)) return new Response(null, { status: 404 });
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(url) || /\.jpg$/i.test(new URL(url).pathname)) {
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

function searchApiRequestUrls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.startsWith(SEARCHAPI_BASE));
}

const imageUrlsOf = (data: Record<string, unknown>) =>
  (data.imageUrls as Array<{ imageUrl: string }>).map((entry) => entry.imageUrl);

const column = {
  id: "imageUrls",
  label: "Image URLs",
  description: "",
  type: "imageUrls" as const,
  enabled: true,
  customInstruction: "Prefer haierlebanon.test",
};

const params = {
  productData: { Brand: "Haier", Code: "HRF-570WH", Description: "NO FROST TOP MOUNT REFRIGERATOR" },
  enabledColumns: ["imageUrls"],
  enrichmentColumns: [column],
  settings: { enrichmentModel: "exact" as const, outputLanguage: "English" },
  kind: "product" as const,
};

describe("Image Finder Exact Match", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SEARCHAPI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call GPT-6 Sol when Google AI Mode finds no exact-match link", async () => {
    const fetchMock = stubFetch({ searchApi: noExactMatch });
    const result = await enrichRow(params);

    // Attempt 1 finds nothing, so the automatic second search runs too.
    expect(searchApiRequestUrls(fetchMock)).toHaveLength(2);
    expect(openAiRequests(fetchMock)).toHaveLength(0);
    expect(result.data).toEqual({
      imageUrls: [],
      [notFoundKey]:
        "Google AI Mode found no exact-match product page for this item (search 1: returned no links; search 2: returned no links).",
      [matchBasisKey]: "",
      [matchNoteKey]: "",
    });
    expect(result.costs).toHaveLength(2);
    expect(result.costs.every((cost) => cost.searchApiCost > 0)).toBe(true);
  });

  it("does not call GPT-6 Sol when every candidate link fails the checks (bare domain)", async () => {
    const fetchMock = stubFetch({ searchApi: () => matchesFound([{ url: "footshop.test" }]) });
    const result = await enrichRow(params);

    expect(openAiRequests(fetchMock)).toHaveLength(0);
    expect(result.data.imageUrls).toEqual([]);
    expect(result.data[notFoundKey]).toContain("all rejected: 1 not a full product URL");
    expect(result.costs).toHaveLength(2);
  });

  it("runs the automatic second search when the first finds nothing, then hands its link to Agent 2", async () => {
    let call = 0;
    const fetchMock = stubFetch({
      searchApi: () =>
        ++call === 1
          ? noExactMatch()
          : matchesFound([{ url: KNOWN_LINK, evidence: "SKU: HRF-570WH", matchedOn: "brand+description" }]),
      openAi: oneShotResponse({ status: "found", images: [image(FRONT)], notes: "" }),
    });
    const result = await enrichRow(params);

    expect(searchApiRequestUrls(fetchMock)).toHaveLength(2);
    const prompt = openAiRequests(fetchMock)[0].input[0].content.at(-1).text as string;
    expect(prompt).toContain("Matched by: description only");
    expect(imageUrlsOf(result.data)).toEqual([FRONT]);
    // Two SearchApi calls + Agent 2's OpenAI call.
    expect(result.costs).toHaveLength(3);
    expect(result.costs.filter((cost) => cost.searchApiCost > 0)).toHaveLength(2);
  });

  it("tells Agent 2 how each link was matched (code vs description only)", async () => {
    const fetchMock = stubFetch({
      searchApi: () => matchesFound([{ url: KNOWN_LINK, evidence: "SKU: HRF-570WH", matchedOn: "code" }]),
      openAi: oneShotResponse({ status: "found", images: [image(FRONT)], notes: "" }),
    });
    await enrichRow(params);

    expect(searchApiRequestUrls(fetchMock)).toHaveLength(1);
    const prompt = openAiRequests(fetchMock)[0].input[0].content.at(-1).text as string;
    expect(prompt).toContain("Matched by: code");
  });

  it("passes Agent 1's checked link to Agent 2 as a known exact-match page, with the Exact skill and model", async () => {
    const fetchMock = stubFetch({
      searchApi: () => matchesFound([{ url: KNOWN_LINK, evidence: "SKU: HRF-570WH", site: "Haier Lebanon" }]),
      openAi: oneShotResponse({ status: "found", images: [image(FRONT)], notes: "Confirmed on Haier Lebanon" }),
    });
    const result = await enrichRow(params);

    const requests = openAiRequests(fetchMock);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.instructions).toBe(IMAGE_FINDER_EXACT_IMAGES_SKILL);
    expect(request.model).toBe("gpt-6-sol");
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.text.format.name).toBe("catalog_image_finder_exact");

    const prompt = request.input[0].content.at(-1).text as string;
    expect(prompt).toContain("Known exact-match pages");
    expect(prompt).toContain(KNOWN_LINK);
    expect(prompt).toContain("SKU: HRF-570WH");
    expect(prompt).toContain("Prefer haierlebanon.test");

    expect(imageUrlsOf(result.data)).toEqual([FRONT]);
    expect(result.data[matchBasisKey]).toBe(EXACT_MATCH_BASIS);
    expect(result.data[matchNoteKey]).toBe(EXACT_MATCH_NOTE);
    expect(result.costs).toHaveLength(2);
    expect(result.costs[0].searchApiCost).toBeGreaterThan(0);
  });

  it("decodes a percent-encoded image URL when the raw form does not load", async () => {
    stubFetch({
      searchApi: () => matchesFound([{ url: KNOWN_LINK }]),
      openAi: oneShotResponse({ status: "found", images: [image(ENCODED_IMAGE)], notes: "" }),
      deadImages: [ENCODED_IMAGE],
    });
    const result = await enrichRow(params);
    expect(imageUrlsOf(result.data)).toEqual([DECODED_IMAGE]);
  });

  it("only keeps images whose page GPT-6 Sol actually opened in this call", async () => {
    stubFetch({
      searchApi: () => matchesFound([{ url: KNOWN_LINK }]),
      openAi: oneShotResponse(
        {
          status: "found",
          images: [image(FRONT), image("https://other.test/similar.jpg", "https://other.test/never-opened")],
          notes: "",
        },
        [PAGE] // only PAGE was opened, not other.test
      ),
    });
    const result = await enrichRow(params);
    expect(imageUrlsOf(result.data)).toEqual([FRONT]);
  });

  it("reports zero images confirmed when Agent 2 says not found", async () => {
    stubFetch({
      searchApi: () => matchesFound([{ url: KNOWN_LINK }]),
      openAi: oneShotResponse({ status: "not_found", images: [], notes: "Could not open the known page; nothing else found." }, []),
    });
    const result = await enrichRow(params);
    expect(result.data.imageUrls).toEqual([]);
    expect(result.data[notFoundKey]).toContain("Could not open the known page");
    expect(result.data[matchBasisKey]).toBe("");
  });

  it("still bills the SearchApi call when Agent 2's OpenAI call fails outright", async () => {
    stubFetch({
      searchApi: () => matchesFound([{ url: KNOWN_LINK }]),
      openAi: () =>
        new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "exceeded your current quota" } }), {
          status: 429,
        }),
    });
    await expect(enrichRow(params)).rejects.toMatchObject({
      name: "EnrichProviderUnavailableError",
    });
    // Re-run to inspect the costs carried on the thrown error.
    try {
      await enrichRow(params);
      throw new Error("expected enrichRow to throw");
    } catch (error) {
      const costs = (error as { costs?: Array<{ searchApiCost: number }> }).costs ?? [];
      expect(costs.some((cost) => cost.searchApiCost > 0)).toBe(true);
    }
  });
});
