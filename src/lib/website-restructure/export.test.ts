import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  WR_LOGO_PLACEHOLDER,
  buildStandaloneHtmlDocument,
  injectLogoSrc,
  logoUrlToDataUri,
} from "./export";
import type { WrBuildResult } from "./types";

const sampleResult: WrBuildResult = {
  html: `<header><img src="${WR_LOGO_PLACEHOLDER}" alt="logo" /><nav>Shop</nav></header>`,
  css: "header { color: red; }",
  js: "console.log('hi')",
  notes: "A simple header",
};

describe("injectLogoSrc", () => {
  it("replaces the placeholder with the real src", () => {
    const out = injectLogoSrc(sampleResult.html, "https://cdn.example.com/logo.png");
    expect(out).toContain('src="https://cdn.example.com/logo.png"');
    expect(out).not.toContain(WR_LOGO_PLACEHOLDER);
  });

  it("removes the placeholder cleanly when there is no logo", () => {
    const out = injectLogoSrc(sampleResult.html, null);
    expect(out).toContain('src=""');
    expect(out).not.toContain(WR_LOGO_PLACEHOLDER);
  });
});

describe("buildStandaloneHtmlDocument", () => {
  it("produces a well-formed, self-contained document", () => {
    const doc = buildStandaloneHtmlDocument({
      result: sampleResult,
      logoSrc: "data:image/png;base64,AAAA",
      title: "My Store — Header",
    });

    expect(doc.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(doc).toContain('<html lang="en" dir="ltr">');
    expect(doc).toContain("<style>");
    expect(doc).toContain("header { color: red; }");
    expect(doc).toContain("data:image/png;base64,AAAA");
    expect(doc).toContain("console.log('hi')");
    expect(doc).toContain("</html>");
  });

  it("escapes the title so untrusted store names cannot break the document", () => {
    const doc = buildStandaloneHtmlDocument({
      result: sampleResult,
      logoSrc: null,
      title: '<script>alert(1)</script>',
    });
    expect(doc).not.toContain("<script>alert(1)</script>");
    expect(doc).toContain("&lt;script&gt;");
  });

  it("sets dir=rtl and an Arabic lang when the brief calls for RTL", () => {
    const doc = buildStandaloneHtmlDocument({ result: sampleResult, logoSrc: null, dir: "rtl" });
    expect(doc).toContain('<html lang="ar" dir="rtl">');
  });
});

describe("logoUrlToDataUri", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("converts a fetched image into a base64 data URI", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => bytes.buffer,
    });

    const uri = await logoUrlToDataUri("https://example.com/logo.png");
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it("returns null instead of throwing when the fetch fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const uri = await logoUrlToDataUri("https://example.com/missing.png");
    expect(uri).toBeNull();
  });

  it("returns null instead of throwing when fetch itself rejects", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const uri = await logoUrlToDataUri("https://example.com/logo.png");
    expect(uri).toBeNull();
  });
});
