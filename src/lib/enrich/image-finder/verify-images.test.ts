import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyImageUrl, verifyImageUrls } from "./verify-images";

describe("verifyImageUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a URL that answers HEAD with an image content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { "content-type": "image/png" } }))
    );
    await expect(verifyImageUrl("https://cdn.example.com/a.png")).resolves.toBe(true);
  });

  it("rejects a URL that 404s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    );
    await expect(verifyImageUrl("https://cdn.example.com/missing.jpg")).resolves.toBe(false);
  });

  it("rejects a URL that loads but is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { "content-type": "text/html" } }))
    );
    await expect(verifyImageUrl("https://example.com/product")).resolves.toBe(false);
  });

  it("falls back to a ranged GET when HEAD is blocked (403/405/501)", async () => {
    const fetchMock = vi.fn((_url: string, init: { method?: string }) => {
      if (init.method === "HEAD") return Promise.resolve(new Response(null, { status: 405 }));
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyImageUrl("https://cdn.example.com/blocks-head.jpg")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to GET for a definitive rejection like 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyImageUrl("https://cdn.example.com/missing.jpg")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a network error or timeout as not verified, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    await expect(verifyImageUrl("https://cdn.example.com/unreachable.jpg")).resolves.toBe(false);
  });
});

describe("verifyImageUrls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("bad")
            ? new Response(null, { status: 404 })
            : new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } })
        )
      )
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns only the URLs that verify, lowercased for lookup", async () => {
    const verified = await verifyImageUrls([
      "https://cdn.example.com/Good.jpg",
      "https://cdn.example.com/bad.jpg",
    ]);
    expect(verified.has("https://cdn.example.com/good.jpg")).toBe(true);
    expect(verified.has("https://cdn.example.com/bad.jpg")).toBe(false);
  });

  it("dedupes before verifying", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await verifyImageUrls([
      "https://cdn.example.com/good.jpg",
      "https://cdn.example.com/good.jpg",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty set for an empty input", async () => {
    const verified = await verifyImageUrls([]);
    expect(verified.size).toBe(0);
  });
});
