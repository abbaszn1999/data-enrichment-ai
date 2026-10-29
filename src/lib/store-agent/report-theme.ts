/**
 * An HTML report runs in a sandboxed frame that cannot see the app's theme,
 * so the report is told it through `data-theme` on its `<html>`. Reports
 * written before that rule have their own fixed colors and stay on a light
 * page. Links open in a new tab rather than inside the frame.
 */
export function themedReport(html: string, dark: boolean): { doc: string; themed: boolean } {
  let doc = /<base\s/i.test(html) ? html : html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base target="_blank">`);
  const themed = /data-theme/i.test(html);
  if (!themed) return { doc, themed };
  const attrs = ` data-theme="${dark ? "dark" : "light"}"`;
  const tag = /<html(\s[^>]*)?>/i;
  doc = tag.test(doc)
    ? doc.replace(tag, (_m, rest = "") => `<html${rest.replace(/\sdata-theme\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "").replace(/\/$/, "")}${attrs}>`)
    : `<html${attrs}>${doc}</html>`;
  return { doc, themed };
}
