/**
 * Builds a standards-compliant XML sitemap (the sitemaps.org protocol Google
 * Search and other crawlers parse) for a project's published collection
 * pages, so a merchant can upload the file to their server and submit its
 * URL straight to Google Search Console.
 *
 * Deliberately carries only <loc> and <lastmod>. Google's own developer
 * documentation states <changefreq> and <priority> are ignored by its
 * crawler, so including them only adds dead weight to the file; <lastmod>
 * is the one extra signal Google says it actually uses.
 */
export function buildCollectionsSitemapXml(
  urls: string[],
  lastmod: string = new Date().toISOString().slice(0, 10)
): string {
  const entries = urls
    .filter((url) => Boolean(url && url.trim()))
    .map(
      (url) =>
        `  <url>\n    <loc>${escapeXmlText(url.trim())}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    (entries ? `${entries}\n` : "") +
    `</urlset>\n`
  );
}

/**
 * Escapes the 5 XML-reserved characters so a URL that happens to carry an
 * ampersand or quote (rare, but store handles are merchant-editable) can
 * never corrupt the document or break the enclosing <loc> tag.
 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
