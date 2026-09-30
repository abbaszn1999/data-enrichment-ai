import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkImageUrl,
  decodedVariant,
  keepLoadableImages,
  looksLikeImageBytes,
  unverifiedImagesNote,
  verifyImageUrl,
  verifyImageUrls,
} from "./verify-images";

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

describe("browser-like load check", () => {
  afterEach(() => vi.unstubAllGlobals());

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

  it("sends a browser User-Agent, an image Accept header and the product page as Referer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    await checkImageUrl("https://cdn.test/a.png", { pageUrl: "https://shop.test/p/1" });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla\/5\.0/);
    expect(headers.Accept).toContain("image/avif");
    expect(headers.Referer).toBe("https://shop.test/p/1");
  });

  it("recognises an image by its first bytes when the server sends a vague content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { method?: string }) =>
        Promise.resolve(
          init.method === "HEAD"
            ? new Response(null, { status: 200, headers: { "content-type": "application/octet-stream" } })
            : new Response(jpeg, { status: 200, headers: { "content-type": "application/octet-stream" } })
        )
      )
    );
    expect(await checkImageUrl("https://cdn.test/no-type", { retryDelayMs: 0 })).toBe("ok");
  });

  it("rejects an octet-stream body that is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("<html></html>", { status: 200, headers: { "content-type": "application/octet-stream" } }))
      )
    );
    expect(await checkImageUrl("https://cdn.test/page", { retryDelayMs: 0 })).toBe("rejected");
  });

  it("looksLikeImageBytes knows JPEG, PNG, GIF, WebP and AVIF", () => {
    const text = (s: string) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));
    expect(looksLikeImageBytes(jpeg)).toBe(true);
    expect(looksLikeImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
    expect(looksLikeImageBytes(text("GIF89a"))).toBe(true);
    expect(looksLikeImageBytes(text("RIFF\0\0\0\0WEBPVP8 "))).toBe(true);
    expect(looksLikeImageBytes(text("\0\0\0\0ftypavif"))).toBe(true);
    expect(looksLikeImageBytes(text("<!doctype html>"))).toBe(false);
    expect(looksLikeImageBytes(new Uint8Array())).toBe(false);
  });

  it("410 is rejected without a retry; 403 is retried once and then unverified, not rejected", async () => {
    const gone = vi.fn().mockResolvedValue(new Response(null, { status: 410 }));
    vi.stubGlobal("fetch", gone);
    expect(await checkImageUrl("https://cdn.test/gone.jpg", { retryDelayMs: 0 })).toBe("rejected");
    expect(gone).toHaveBeenCalledTimes(1);

    const blocked = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", blocked);
    expect(await checkImageUrl("https://cdn.test/hotlink.jpg", { retryDelayMs: 0 })).toBe("unverified");
    // HEAD + GET, then the same again on the single retry.
    expect(blocked).toHaveBeenCalledTimes(4);
  });

  it("a 429 that clears on the retry is confirmed", async () => {
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        round += 1;
        return Promise.resolve(
          round <= 2 ? new Response(null, { status: 429 }) : new Response(null, { status: 200, headers: { "content-type": "image/webp" } })
        );
      })
    );
    expect(await checkImageUrl("https://cdn.test/busy.webp", { retryDelayMs: 0 })).toBe("ok");
  });
});

describe("keepLoadableImages", () => {
  afterEach(() => vi.unstubAllGlobals());
  const candidate = (imageUrl: string) => ({ imageUrl, pageUrl: "https://shop.test/p/1", title: "t" });

  it("keeps loaded and unverified images, drops gone ones, and counts the unverified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("gone")) return Promise.resolve(new Response(null, { status: 404 }));
        if (url.includes("blocked")) return Promise.resolve(new Response(null, { status: 403 }));
        return Promise.resolve(new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } }));
      })
    );
    const result = await keepLoadableImages(
      [candidate("https://cdn.test/ok.jpg"), candidate("https://cdn.test/gone.jpg"), candidate("https://cdn.test/blocked.jpg")],
      10
    );
    expect(result.images.map((i) => i.imageUrl)).toEqual(["https://cdn.test/ok.jpg", "https://cdn.test/blocked.jpg"]);
    expect(result.unverified).toBe(1);
  }, 15_000);

  it("falls back to the percent-decoded link when only that one loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("%3A")
            ? new Response(null, { status: 404 })
            : new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } })
        )
      )
    );
    const result = await keepLoadableImages([candidate("https://cdn.test/f%3Aavif/a.jpg")], 5);
    expect(result.images.map((i) => i.imageUrl)).toEqual(["https://cdn.test/f:avif/a.jpg"]);
    expect(result.unverified).toBe(0);
  });

  it("respects the limit and describes unverified images in a note", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 200, headers: { "content-type": "image/png" } }))));
    const result = await keepLoadableImages([1, 2, 3].map((n) => candidate(`https://cdn.test/${n}.png`)), 2);
    expect(result.images).toHaveLength(2);
    expect(unverifiedImagesNote(0)).toBe("");
    expect(unverifiedImagesNote(1)).toContain("1 image could not");
    expect(unverifiedImagesNote(3)).toContain("3 images could not");
    expect(decodedVariant("https://x.test/a.jpg")).toBeNull();
  });
});
