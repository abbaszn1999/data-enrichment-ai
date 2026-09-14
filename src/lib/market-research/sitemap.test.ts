import { describe, expect, it } from "vitest";
import { buildCollectionsSitemapXml, escapeXmlText } from "./sitemap";

describe("buildCollectionsSitemapXml", () => {
  it("wraps every url in a <url><loc>/<lastmod> entry per the sitemaps.org protocol", () => {
    const xml = buildCollectionsSitemapXml(
      [
        "https://mystore.myshopify.com/collections/running-shoes",
        "https://mystore.myshopify.com/collections/hiking-boots",
      ],
      "2026-09-14"
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml).toContain(
      "<loc>https://mystore.myshopify.com/collections/running-shoes</loc>"
    );
    expect(xml).toContain(
      "<loc>https://mystore.myshopify.com/collections/hiking-boots</loc>"
    );
    expect(xml.match(/<lastmod>2026-09-14<\/lastmod>/g)?.length).toBe(2);
    expect(xml).toContain("</urlset>");
  });

  it("never emits <changefreq> or <priority> — Google ignores both", () => {
    const xml = buildCollectionsSitemapXml([
      "https://mystore.myshopify.com/collections/running-shoes",
    ]);
    expect(xml).not.toContain("changefreq");
    expect(xml).not.toContain("priority");
  });

  it("drops blank/whitespace-only urls instead of emitting an empty <loc>", () => {
    const xml = buildCollectionsSitemapXml([
      "https://mystore.myshopify.com/collections/running-shoes",
      "",
      "   ",
    ]);
    expect(xml.match(/<url>/g)?.length).toBe(1);
  });

  it("produces a well-formed (but empty) urlset when given no urls", () => {
    const xml = buildCollectionsSitemapXml([]);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>'
    );
    expect(xml).not.toContain("<url>");
  });

  it("escapes XML-reserved characters in a url so the document stays valid", () => {
    const xml = buildCollectionsSitemapXml([
      "https://mystore.myshopify.com/collections/men's-&-boys",
    ]);
    expect(xml).toContain(
      "<loc>https://mystore.myshopify.com/collections/men&apos;s-&amp;-boys</loc>"
    );
  });

  it("defaults lastmod to today when not provided", () => {
    const today = new Date().toISOString().slice(0, 10);
    const xml = buildCollectionsSitemapXml([
      "https://mystore.myshopify.com/collections/running-shoes",
    ]);
    expect(xml).toContain(`<lastmod>${today}</lastmod>`);
  });
});

describe("escapeXmlText", () => {
  it("escapes all 5 XML-reserved characters", () => {
    expect(escapeXmlText(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f"
    );
  });
});
