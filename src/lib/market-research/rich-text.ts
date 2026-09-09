/**
 * Strict, allowlist-only sanitizer for the small amount of HTML the Stage 6
 * on-page agent is allowed to emit: a same-site relative anchor inside a
 * collection description or FAQ answer (see stage6-on-page-generator.ts's
 * `sanitizeAnchors`, which already guarantees every href it lets through
 * matches that collection's verified internal-links list).
 *
 * This mirrors `sanitizeFaqAnswer` in `public/widget.js` exactly, so the
 * admin dashboard and the live storefront widget render the same anchors
 * the same way. Only `<a href="/...">text</a>` survives; every other tag,
 * attribute, or malformed markup is escaped to plain text.
 */

function escapeHtml(value: string): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const ANCHOR_RE = /<a\s+href="([^"<>]*)"\s*>([^<]*)<\/a>/gi;

/**
 * Escapes everything except a verified-shape `<a href="/...">text</a>` tag,
 * which is re-emitted as a real, clickable anchor. Safe to pass straight to
 * `dangerouslySetInnerHTML`.
 */
export function sanitizeRichText(value: string | undefined | null): string {
  if (!value) return "";
  const text = String(value);
  let out = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANCHOR_RE.lastIndex = 0;
  while ((match = ANCHOR_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(lastIndex, match.index));
    const href = match[1];
    const label = match[2];
    const isSafeRelativeHref = href.charAt(0) === "/" && href.charAt(1) !== "/";
    if (isSafeRelativeHref) {
      out += `<a href="${escapeHtml(href)}" class="underline underline-offset-2 text-primary hover:text-primary/80">${escapeHtml(label)}</a>`;
    } else {
      // Not a verified same-site link — keep the visible text, drop the tag.
      out += escapeHtml(label);
    }
    lastIndex = ANCHOR_RE.lastIndex;
  }
  out += escapeHtml(text.slice(lastIndex));
  return out;
}

/** Plain-text projection for table cells / previews — strips any anchor tags entirely. */
export function stripTags(value: string | undefined | null): string {
  if (!value) return "";
  return String(value).replace(/<[^>]*>/g, "");
}
