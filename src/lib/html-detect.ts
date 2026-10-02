const HTML_TAG_RE =
  /<\/?(?:p|div|section|article|header|footer|main|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|caption|strong|em|b|i|u|br|hr|span|a|img|blockquote|dl|dt|dd|figure|figcaption|small|sup|sub|code|pre)\b[^>]*>/gi;

/** True when a value is real HTML markup (at least two known tags), not text like "<5kg". */
export function looksLikeHtml(value: string): boolean {
  if (!value || value.indexOf("<") === -1) return false;
  HTML_TAG_RE.lastIndex = 0;
  let count = 0;
  while (HTML_TAG_RE.exec(value)) {
    if (++count >= 2) return true;
  }
  return false;
}

/**
 * A list whose entries are HTML (a table, bullet markup) is one document, not a
 * list: it is stored as a single string so the sheet shows the HTML badge and
 * the preview. Any other list stays a list.
 */
export function collapseHtmlList(items: string[]): string | string[] {
  return items.some((item) => looksLikeHtml(item)) ? items.join("\n") : items;
}
