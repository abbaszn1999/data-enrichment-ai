/**
 * Column values are final content for a CMS. Models that used web search often
 * leave citations inside the text: "(example.com)", "([Shop](https://…))",
 * "?utm_source=openai", or a closing "Sources:" list. This removes them.
 *
 * Only citation-shaped text is touched. A markdown link the owner asked for in
 * running text, and HTML anchors, stay as written.
 */

const TLDS =
  "com|net|org|co|uk|io|de|fr|it|es|nl|se|no|dk|fi|pl|eu|us|ca|au|nz|ae|sa|eg|info|shop|store|biz|app|dev|me|ru|jp|cn|in|br|mx|ch|at|be|ie|pt|gr|tr|cz|hu|ro";

const DOMAIN = `(?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)+(?:${TLDS})(?:\\/[^\\s)\\]]*)?`;
const MD_LINK = "\\[[^\\]]*\\]\\(\\s*https?:\\/\\/[^)\\s]+\\s*\\)";
const CITATION_ITEM = `(?:${MD_LINK}|https?:\\/\\/[^\\s)]+|${DOMAIN})`;

/** "(example.com)", "([Shop](https://shop.com/a))", "(a.com, b.com)" */
const PAREN_CITATION = new RegExp(
  `[ \\t]*(?<!\\])\\(\\s*${CITATION_ITEM}(?:\\s*[,;]\\s*${CITATION_ITEM})*\\s*\\)`,
  "gi"
);
/** "[shop.com](https://…)" that is only a site name used as a citation, outside parentheses. */
const DOMAIN_LINK = new RegExp(
  `[ \\t]*\\[\\s*${DOMAIN}\\s*\\]\\(\\s*https?:\\/\\/[^)\\s]+\\s*\\)`,
  "gi"
);
const OPENAI_UTM_LINK = /\[([^\]]*)\]\(\s*(https?:\/\/[^)\s]*utm_source=openai[^)\s]*)\s*\)/gi;
const OPENAI_UTM_PARAM = /([?&])utm_source=openai(&?)/gi;
const SOURCES_TAIL =
  /\n+[ \t]*(?:[*_#>-]+\s*)?(?:sources?|references?|citations?)(?:[*_]+)?\s*:[\s\S]*$/i;

function stripFromString(text: string): string {
  let out = text;

  out = out.replace(PAREN_CITATION, "");
  out = out.replace(DOMAIN_LINK, "");
  out = out.replace(OPENAI_UTM_LINK, (_match, label: string) => label);

  const tail = out.match(SOURCES_TAIL);
  if (tail && /https?:\/\/|\]\(|\.(?:com|net|org|co|io)\b/i.test(tail[0])) {
    out = out.slice(0, tail.index);
  }

  out = out.replace(OPENAI_UTM_PARAM, (_m, lead: string, trail: string) =>
    lead === "?" && trail ? "?" : trail ? lead : ""
  );

  if (out === text) return text;
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function stripCitations<T>(value: T): T {
  if (typeof value === "string") return stripFromString(value) as T;
  if (Array.isArray(value)) return value.map((item) => stripCitations(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, stripCitations(item)])
    ) as T;
  }
  return value;
}

/** Columns whose whole job is to hold links; their values are validated elsewhere. */
export const CITATION_SAFE_COLUMNS = new Set(["sourceUrls", "imageUrls", "internalLinks", "categories"]);
