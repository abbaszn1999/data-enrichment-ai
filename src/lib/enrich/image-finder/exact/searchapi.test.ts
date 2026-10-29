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

  it("hangs up at once when the caller aborts, even if the transport never answers", async () => {
    // A fetch that ignores the abort signal and never settles.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const controller = new AbortController();
    const call = callGoogleAiMode("x", { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(call).rejects.toMatchObject({ name: "SearchApiCallError", billed: false, hungUp: true });
    await expect(call).rejects.toThrow(/cancelled/);
  });

  it("does not even send a call whose signal is already aborted, and gives up at the timeout it is given", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const done = new AbortController();
    done.abort();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    // Never left, so it is not a hang-up on a sent request.
    await expect(callGoogleAiMode("x", { signal: done.signal })).rejects.toMatchObject({ hungUp: false });
    await expect(callGoogleAiMode("x", { signal: done.signal })).rejects.toThrow(/cancelled/);
    expect(fetchMock).not.toHaveBeenCalled();
    // The timeout hangs up on a request that was sent.
    await expect(callGoogleAiMode("x", { timeoutMs: 20 })).rejects.toThrow(/timeout/);
    await expect(callGoogleAiMode("x", { timeoutMs: 20 })).rejects.toMatchObject({ billed: false, hungUp: true });
  });

  it("does not mark error answers or network failures as hung up on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 500 })));
    await expect(callGoogleAiMode("x")).rejects.toMatchObject({ billed: false, hungUp: false, status: 500 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(callGoogleAiMode("x")).rejects.toMatchObject({ billed: false, hungUp: false });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(callGoogleAiMode("x")).rejects.toMatchObject({ billed: false, hungUp: false });
  });

  it("sends a location only when one is given", async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit?]) =>
      new Response(JSON.stringify({ search_metadata: { status: "Success" }, markdown: "ok" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await callGoogleAiMode("x");
    await callGoogleAiMode("x", { location: "United Kingdom" });

    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.has("location")).toBe(false);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("location")).toBe("United Kingdom");
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
