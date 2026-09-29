import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callGoogleAiMode, requireSearchApiKey } from "./searchapi";

describe("requireSearchApiKey", () => {
  const original = process.env.SEARCHAPI_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.SEARCHAPI_API_KEY;
    else process.env.SEARCHAPI_API_KEY = original;
  });

  it("throws a clear, actionable error when unset", () => {
    delete process.env.SEARCHAPI_API_KEY;
    expect(() => requireSearchApiKey()).toThrow(/SEARCHAPI_API_KEY is not configured/);
  });

  it("returns the trimmed key when set", () => {
    process.env.SEARCHAPI_API_KEY = "  test-key  ";
    expect(requireSearchApiKey()).toBe("test-key");
  });
});

describe("callGoogleAiMode", () => {
  beforeEach(() => {
    process.env.SEARCHAPI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends engine=google_ai_mode and the query, and returns the joined text_blocks", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) =>
      new Response(
        JSON.stringify({
          search_metadata: { status: "Success" },
          text_blocks: [{ type: "paragraph", answer: '{"result":"MATCHES_FOUND","matches":[]}' }],
          markdown: '{"result":"MATCHES_FOUND","matches":[]}',
          reference_links: [{ link: "https://shop.test/p/1", title: "Shop" }],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callGoogleAiMode("AN7312 Panasonic");

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("engine=google_ai_mode");
    expect(url).toContain("AN7312");
    expect(url).toContain("api_key=test-key");
    expect(result.text).toBe('{"result":"MATCHES_FOUND","matches":[]}');
    expect(result.referenceLinks).toEqual([{ link: "https://shop.test/p/1", title: "Shop", snippet: undefined, source: undefined }]);
  });

  it("falls back to markdown when there are no text_blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ markdown: "STATUS: NOT_FOUND" }), { status: 200 }))
    );
    const result = await callGoogleAiMode("x");
    expect(result.text).toBe("STATUS: NOT_FOUND");
  });

  it("throws with the status code on a non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("server error", { status: 500 })));
    await expect(callGoogleAiMode("x")).rejects.toThrow(/failed \(500\)/);
  });

  it("throws when the API reports an error even with HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Invalid API key." }), { status: 200 }))
    );
    await expect(callGoogleAiMode("x")).rejects.toThrow(/Invalid API key/);
  });

  it("throws on a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>not json</html>", { status: 200 })));
    await expect(callGoogleAiMode("x")).rejects.toThrow(/non-JSON/);
  });

  it("throws a clear error when the network request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    await expect(callGoogleAiMode("x")).rejects.toThrow(/request failed/);
  });

  it("filters out reference links that are not valid http(s) URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              markdown: "ok",
              reference_links: [{ link: "not-a-url" }, { link: "https://shop.test/p" }],
            }),
            { status: 200 }
          )
      )
    );
    const result = await callGoogleAiMode("x");
    expect(result.referenceLinks).toHaveLength(1);
    expect(result.referenceLinks[0].link).toBe("https://shop.test/p");
  });
});
