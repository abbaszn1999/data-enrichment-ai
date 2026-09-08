import { describe, expect, it } from "vitest";
import { sanitizeRichText, stripTags } from "./rich-text";

describe("sanitizeRichText", () => {
  it("keeps a verified same-site relative anchor as a real, clickable link", () => {
    const html = 'See our <a href="/collections/apple-chargers">Apple chargers</a> too.';
    const out = sanitizeRichText(html);
    expect(out).toContain('<a href="/collections/apple-chargers"');
    expect(out).toContain(">Apple chargers</a>");
  });

  it("drops an off-site or protocol-relative href, keeping the visible text", () => {
    expect(sanitizeRichText('<a href="https://evil.com">click</a>')).toBe("click");
    expect(sanitizeRichText('<a href="//evil.com">click</a>')).toBe("click");
  });

  it("drops a javascript: href, keeping the visible text", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">click</a>')).toBe("click");
  });

  it("escapes any other tag rather than rendering it", () => {
    const out = sanitizeRichText('<script>alert(1)</script>plain');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("plain");
  });

  it("escapes plain text with HTML-significant characters", () => {
    expect(sanitizeRichText("A & B < C")).toBe("A &amp; B &lt; C");
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeRichText("")).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
    expect(sanitizeRichText(null)).toBe("");
  });
});

describe("stripTags", () => {
  it("removes anchor markup but keeps the visible text", () => {
    expect(stripTags('See our <a href="/collections/x">chargers</a> too.')).toBe(
      "See our chargers too."
    );
  });

  it("removes any other tag", () => {
    expect(stripTags("<b>bold</b> and <script>bad()</script>")).toBe("bold and bad()");
  });

  it("returns an empty string for empty input", () => {
    expect(stripTags("")).toBe("");
    expect(stripTags(undefined)).toBe("");
  });
});
