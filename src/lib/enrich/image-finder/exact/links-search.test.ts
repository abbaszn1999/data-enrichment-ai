import { afterEach, describe, expect, it, vi } from "vitest";

const { callGoogleAiMode } = vi.hoisted(() => ({ callGoogleAiMode: vi.fn() }));
vi.mock("./searchapi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./searchapi")>()),
  callGoogleAiMode,
}));

const { searchExactLinks, parseBestAnswer } = await import("./links-search");
const { SearchApiCallError } = await import("./searchapi");

const input = {
  rowData: { Brand: "Haier", Code: "HRF-570WH" },
  rowIdentifiers: ["HRF-570WH"],
};

function call(texts: string[], referenceLinks: Array<{ link: string }> = []) {
  return { text: texts[0] ?? "", texts, referenceLinks, httpStatus: 200, elapsedMs: 5 };
}
const found = (url: string) =>
  call([JSON.stringify({ result: "MATCHES_FOUND", matches: [{ url, evidence: "HRF-570WH" }] })]);
const none = () => call([JSON.stringify({ result: "NO_EXACT_MATCH", matches: [] })]);

afterEach(() => callGoogleAiMode.mockReset());

describe("searchExactLinks", () => {
  it("makes one call when the first search finds a usable link", async () => {
    callGoogleAiMode.mockResolvedValueOnce(found("https://shop.test/p/1"));
    const result = await searchExactLinks(input);

    expect(callGoogleAiMode).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.links.map((l) => l.url)).toEqual(["https://shop.test/p/1"]);
    expect(result.costs).toHaveLength(1);
    expect(result.notFoundReason).toBe("");
  });

  it("retries once with the different-angles prompt when the first search finds nothing", async () => {
    callGoogleAiMode.mockResolvedValueOnce(none()).mockResolvedValueOnce(found("https://shop.test/p/2"));
    const result = await searchExactLinks(input);

    expect(callGoogleAiMode).toHaveBeenCalledTimes(2);
    expect(callGoogleAiMode.mock.calls[0][0]).not.toContain("angles beyond the obvious");
    expect(callGoogleAiMode.mock.calls[1][0]).toContain("angles beyond the obvious");
    expect(result.attempts).toBe(2);
    expect(result.links.map((l) => l.url)).toEqual(["https://shop.test/p/2"]);
    expect(result.costs).toHaveLength(2);
  });

  it("retries when the first answer could not be read, and when every link was rejected", async () => {
    callGoogleAiMode
      .mockResolvedValueOnce(call(["Sorry, I cannot help."]))
      .mockResolvedValueOnce(found("https://shop.test/p/3"));
    expect((await searchExactLinks(input)).attempts).toBe(2);

    callGoogleAiMode.mockReset();
    callGoogleAiMode
      .mockResolvedValueOnce(found("https://bare-domain.test"))
      .mockResolvedValueOnce(found("https://shop.test/p/4"));
    expect((await searchExactLinks(input)).links[0].url).toBe("https://shop.test/p/4");
  });

  it("explains both searches when neither finds a link", async () => {
    callGoogleAiMode
      .mockResolvedValueOnce(call(["no json"]))
      .mockResolvedValueOnce(found("https://bare-domain.test"));
    const result = await searchExactLinks(input);

    expect(result.links).toEqual([]);
    expect(result.attempts).toBe(2);
    expect(result.costs).toHaveLength(2);
    expect(result.notFoundReason).toBe(
      "The web search found no exact-match product page for this item " +
        "(search 1: the answer could not be read; search 2: returned 1 link(s), all rejected: 1 not a full product URL)."
    );
  });

  it("does not retry when the first call fails (nothing was billed)", async () => {
    callGoogleAiMode.mockRejectedValueOnce(new SearchApiCallError("SearchApi Google AI Mode failed (401)", false));
    await expect(searchExactLinks(input)).rejects.toThrow("failed (401)");
    expect(callGoogleAiMode).toHaveBeenCalledTimes(1);
  });

  it("charges a first call that failed after SearchApi billed it", async () => {
    callGoogleAiMode.mockRejectedValueOnce(new SearchApiCallError("billed but broken", true));
    await expect(searchExactLinks(input)).rejects.toMatchObject({
      name: "EnrichBilledAttemptError",
      costs: [expect.objectContaining({ searchApiCost: expect.any(Number) })],
    });
  });

  it("stays Not found (not an error) when the second call fails, keeping the first call's cost", async () => {
    callGoogleAiMode.mockResolvedValueOnce(none()).mockRejectedValueOnce(new Error("network down"));
    const result = await searchExactLinks(input);

    expect(result.links).toEqual([]);
    expect(result.costs).toHaveLength(1);
    expect(result.notFoundReason).toContain("search 1: returned no links");
    expect(result.notFoundReason).toContain("search 2 failed: network down");
  });

  it("keeps the cost of a second call that failed after it was billed", async () => {
    callGoogleAiMode.mockResolvedValueOnce(none()).mockRejectedValueOnce(new SearchApiCallError("billed", true));
    const result = await searchExactLinks(input);
    expect(result.costs).toHaveLength(2);
  });

  it("does not run the second search when the job was cancelled", async () => {
    callGoogleAiMode.mockResolvedValueOnce(none());
    await expect(searchExactLinks({ ...input, shouldCancel: async () => true })).rejects.toMatchObject({
      name: "EnrichCancelledError",
      costs: [expect.objectContaining({ searchApiCost: expect.any(Number) })],
    });
    expect(callGoogleAiMode).toHaveBeenCalledTimes(1);
  });

  it("uses the links Google cited when the answer has no readable JSON, and still bills the call", async () => {
    callGoogleAiMode.mockResolvedValueOnce(
      call(["Here you go: https://shop.test/haier-hrf-570wh."], [{ link: "https://other.test/p/hrf-570wh" }])
    );
    const result = await searchExactLinks(input);

    expect(callGoogleAiMode).toHaveBeenCalledTimes(1);
    expect(result.links.map((l) => l.url)).toEqual(["https://shop.test/haier-hrf-570wh", "https://other.test/p/hrf-570wh"]);
    expect(result.links[0].matchedOn).toBe("unstated");
    expect(result.costs).toHaveLength(1);
  });

  it("does not turn an explicit 'no exact match' answer into links from its citations", async () => {
    callGoogleAiMode
      .mockResolvedValueOnce(call([JSON.stringify({ result: "NO_EXACT_MATCH", matches: [] })], [{ link: "https://shop.test/p/x" }]))
      .mockResolvedValueOnce(none());
    const result = await searchExactLinks(input);
    expect(result.links).toEqual([]);
  });
});

describe("parseBestAnswer", () => {
  it("reads the rendering that has the links when the other has none", () => {
    const parsed = parseBestAnswer([
      "The result is below.",
      '```json\n{"result":"MATCHES_FOUND","matches":[{"url":"https://shop.test/p"}]}\n```',
    ]);
    expect(parsed.matches.map((m) => m.url)).toEqual(["https://shop.test/p"]);
  });

  it("prefers a readable 'none' over an unreadable text", () => {
    const parsed = parseBestAnswer(["prose", '{"result":"NO_EXACT_MATCH","matches":[]}']);
    expect(parsed.readable).toBe(true);
    expect(parsed.matches).toEqual([]);
  });

  it("is unreadable when no rendering has JSON", () => {
    expect(parseBestAnswer(["a", "b"]).readable).toBe(false);
    expect(parseBestAnswer([]).readable).toBe(false);
  });
});
