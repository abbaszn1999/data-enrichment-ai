import { afterEach, describe, expect, it, vi } from "vitest";

const { callGoogleAiMode } = vi.hoisted(() => ({ callGoogleAiMode: vi.fn() }));
vi.mock("./searchapi", () => ({ callGoogleAiMode }));

const { searchExactLinks } = await import("./links-search");

const input = {
  rowData: { Brand: "Haier", Code: "HRF-570WH" },
  rowIdentifiers: ["HRF-570WH"],
};

const found = (url: string) =>
  ({ text: JSON.stringify({ result: "MATCHES_FOUND", matches: [{ url, evidence: "HRF-570WH" }] }), referenceLinks: [] });
const none = () => ({ text: JSON.stringify({ result: "NO_EXACT_MATCH", matches: [] }), referenceLinks: [] });

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
    expect(callGoogleAiMode.mock.calls[0][0]).not.toContain("DIFFERENT angles");
    expect(callGoogleAiMode.mock.calls[1][0]).toContain("DIFFERENT angles");
    expect(result.attempts).toBe(2);
    expect(result.links.map((l) => l.url)).toEqual(["https://shop.test/p/2"]);
    expect(result.costs).toHaveLength(2);
  });

  it("retries when the first answer could not be read, and when every link was rejected", async () => {
    callGoogleAiMode
      .mockResolvedValueOnce({ text: "Sorry, I cannot help.", referenceLinks: [] })
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
      .mockResolvedValueOnce({ text: "no json", referenceLinks: [] })
      .mockResolvedValueOnce(found("https://bare-domain.test"));
    const result = await searchExactLinks(input);

    expect(result.links).toEqual([]);
    expect(result.attempts).toBe(2);
    expect(result.costs).toHaveLength(2);
    expect(result.notFoundReason).toBe(
      "Google AI Mode found no exact-match product page for this item " +
        "(search 1: the answer could not be read; search 2: returned 1 link(s), all rejected: 1 not a full product URL)."
    );
  });

  it("does not retry when the first call fails (nothing was billed)", async () => {
    callGoogleAiMode.mockRejectedValueOnce(new Error("SearchApi Google AI Mode failed (401)"));
    await expect(searchExactLinks(input)).rejects.toThrow("failed (401)");
    expect(callGoogleAiMode).toHaveBeenCalledTimes(1);
  });

  it("keeps the first call's cost when the second call fails", async () => {
    callGoogleAiMode.mockResolvedValueOnce(none()).mockRejectedValueOnce(new Error("network down"));
    await expect(searchExactLinks(input)).rejects.toMatchObject({
      name: "EnrichBilledAttemptError",
      message: expect.stringContaining("network down"),
      costs: [expect.objectContaining({ searchApiCost: expect.any(Number) })],
    });
  });

  it("does not run the second search when the job was cancelled", async () => {
    callGoogleAiMode.mockResolvedValueOnce(none());
    await expect(searchExactLinks({ ...input, shouldCancel: async () => true })).rejects.toMatchObject({
      name: "EnrichCancelledError",
      costs: [expect.objectContaining({ searchApiCost: expect.any(Number) })],
    });
    expect(callGoogleAiMode).toHaveBeenCalledTimes(1);
  });
});
