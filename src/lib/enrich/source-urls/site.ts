/**
 * Source URLs, website mode: the owner names ONE website (the column's
 * "Website" setting) and the search asks for that item's page on that site
 * only. This is a different job from the open search in ./skill.ts, so it has
 * its own tiny query and its own checks, and the open search is not touched.
 *
 * Why a separate path. Asked in the open way, with a JSON output rule and a
 * long rulebook, Google AI Mode answers with the site's homepage for some items
 * while the right product page sits only in the pages it cited
 * (`reference_links`). A short plain request answers correctly, so:
 *  - the query is one fixed sentence around the row's source columns exactly as
 *    the sheet has them (header: value), so it works for any sheet layout;
 *  - no JSON is requested: the page is taken from the cited pages and the links
 *    in the answer, and the `{url, title}` sources are built here in code;
 *  - a page is kept only if it is on the requested website and is a page for
 *    one product (not the homepage, a category or a search page). Anything else
 *    gets one simpler second search, then "not found" â€” never a homepage.
 *
 * Pure (no runtime imports beyond helpers), so it is cheap to test.
 */
import { DEFAULT_SOURCE_URLS_INSTRUCTION } from "@/types";
import { hostMatchesDomain, normalizeDomain } from "../domains";
import type { GoogleAiModeReferenceLink } from "../image-finder/exact/searchapi";
import { cleanPageTitle, harvestSourceCandidates, parseBestSourceAnswer } from "./skill";

/** The owner's extra instruction is a short note in this mode; the rest is cut. */
export const SITE_INSTRUCTION_MAX_CHARS = 300;

/** The row's fields in the query: at most this many, each cut at this length, so one query stays one short request. */
export const SITE_MAX_FIELDS = 10;
export const SITE_MAX_FIELD_CHARS = 120;

export type SiteSearchAttempt = 1 | 2;

/** The website setting as a bare domain, or null when empty or not a website. */
export function siteDomainOf(setting: string | undefined | null): string | null {
  return normalizeDomain(String(setting ?? ""));
}

// ---------------------------------------------------------------------------
// The query: the row's own source columns, as typed
// ---------------------------------------------------------------------------

function plain(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isImageValue(value: string): boolean {
  return (
    value.startsWith("data:image/") ||
    /^\[\d+ images? attached\]$/i.test(value) ||
    /^https?:\/\/\S+\.(jpe?g|png|webp|gif|avif)(\?\S*)?$/i.test(value)
  );
}

function cutAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/** Header as the sheet shows it; the importer's placeholder names for unnamed columns read as "Col 1". */
function labelOf(key: string): string {
  return key.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col").trim() || "Field";
}

export interface SiteField {
  label: string;
  value: string;
}

/**
 * Every non-image column of the row that has a value, in sheet order, with the
 * header exactly as the owner's sheet has it. Column names are never read for
 * meaning (the sheets are the owner's or a supplier's, in any layout or
 * language), so nothing is guessed and nothing the sheet says is left out
 * except what the caps below cut.
 */
export function siteFieldsOf(rowData: Record<string, string>): SiteField[] {
  const fields: SiteField[] = [];
  for (const [key, raw] of Object.entries(rowData)) {
    if (fields.length >= SITE_MAX_FIELDS) break;
    const value = plain(raw);
    if (!value || isImageValue(value)) continue;
    fields.push({ label: labelOf(key), value: cutAtWord(value, SITE_MAX_FIELD_CHARS) });
  }
  return fields;
}

/** An all-digit barcode (EAN / UPC / GTIN length), spaces and hyphens allowed. */
function isBarcodeValue(value: string): boolean {
  if (!/^\d[\d\s-]*\d$/.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 14;
}

/**
 * The simpler second search keeps what names the item and drops the rest,
 * judged by the SHAPE of the values, never the headers: every all-digit barcode
 * and the first value that reads as a name (letters, more than one word).
 * Codes, sizes and every other value are dropped.
 */
export function simplifySiteFields(fields: SiteField[]): SiteField[] {
  const keep = new Set<SiteField>();
  for (const field of fields) if (isBarcodeValue(field.value)) keep.add(field);
  const name =
    fields.find((f) => /\p{L}/u.test(f.value) && f.value.split(" ").length >= 2) ??
    fields.find((f) => /\p{L}{3,}/u.test(f.value));
  if (name) keep.add(name);
  return fields.filter((f) => keep.has(f));
}

export interface BuildSiteQueryInput {
  rowData: Record<string, string>;
  /** Bare domain, e.g. "mamasandpapas.com". */
  domain: string;
  customInstruction?: string;
  hasImage?: boolean;
  /** 1 = the full request; 2 = the simpler one (name and barcode only). Defaults to 1. */
  attempt?: SiteSearchAttempt;
}

/** The owner's note for this mode: skipped when it is only the default text, which asks for retailers. */
export function siteInstructionOf(customInstruction: string | undefined): string {
  const text = plain(customInstruction);
  if (!text || text === plain(DEFAULT_SOURCE_URLS_INSTRUCTION)) return "";
  return cutAtWord(text, SITE_INSTRUCTION_MAX_CHARS);
}

function composeSiteQuery(domain: string, fields: SiteField[]): string {
  const lines = [`${domain} product page for this item:`];
  if (fields.length > 0) lines.push(...fields.map((f) => `- ${f.label}: ${f.value}`));
  else lines.push("- (no product details were provided)");
  lines.push(`Return the ${domain} product page link only.`);
  return lines.join("\n");
}

/**
 * The whole request in website mode: one fixed sentence around the row's source
 * columns, as typed. Attempt 1 sends them all (capped); the photo line and the
 * owner's short note come after. Attempt 2 sends only the name and the barcode,
 * no photo, no note, and returns "" when that would be the same question as
 * attempt 1, so no second search is paid for.
 */
export function buildSiteSourceUrlsQuery(input: BuildSiteQueryInput): string {
  const { domain } = input;
  const fields = siteFieldsOf(input.rowData);
  const first = composeSiteQuery(domain, fields);

  if ((input.attempt ?? 1) === 2) {
    const simple = simplifySiteFields(fields);
    if (simple.length === 0) return "";
    const second = composeSiteQuery(domain, simple);
    const firstIsPlain = first === second && !input.hasImage && !siteInstructionOf(input.customInstruction);
    return firstIsPlain ? "" : second;
  }

  const lines = [first];
  if (input.hasImage) lines.push("The attached photo shows the product.");
  const note = siteInstructionOf(input.customInstruction);
  if (note) lines.push(`Note: ${note}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The answer: which links count
// ---------------------------------------------------------------------------

export type SiteLinkProblem = "not_a_link" | "other_site" | "homepage" | "listing_page";

/** A first path segment that is only a language or country prefix: /en, /en-gb, /uk. */
const LOCALE_SEGMENT = /^[a-z]{2}([-_][a-z]{2})?$/i;
/** A single path segment that names a shop section, not an item. */
const SECTION_SEGMENT =
  /^(products?|shop|store|stores|search|catalog(ue)?|collections?|categories|category|brands?|sale|new|new-in|all|home|index(\.html?)?|pages?)$/i;
/** `/collections/<name>` style paths are listings unless they go on to a product. */
const LISTING_ROOTS = /^(collections?|categories|category)$/i;
const PRODUCT_MARKER = /^(products?|p|item|items|dp)$/i;

/**
 * Whether a link is a page for one item on `domain`: it must be on that website
 * (www and country subdomains are fine), go deeper than the home page (a
 * language prefix alone is still the home page), and not be a search, category
 * or collection page.
 */
export function siteLinkProblem(raw: string, domain: string): SiteLinkProblem | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "not_a_link";
  }
  if (!/^https?:$/.test(url.protocol)) return "not_a_link";
  if (!hostMatchesDomain(url.hostname.toLowerCase().replace(/\.$/, ""), domain)) return "other_site";

  let segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] && LOCALE_SEGMENT.test(segments[0])) segments = segments.slice(1);
  if (segments.length === 0) return "homepage";

  if (segments.length === 1 && SECTION_SEGMENT.test(segments[0]!)) return "listing_page";
  if (
    segments.length <= 2 &&
    LISTING_ROOTS.test(segments[0]!) &&
    !segments.some((segment, index) => index > 0 && PRODUCT_MARKER.test(segment))
  ) {
    return "listing_page";
  }
  if (/^\/(search|s|catalogsearch)(\/|$)/i.test(url.pathname)) return "listing_page";
  if (url.searchParams.has("q") && /search/i.test(url.pathname)) return "listing_page";
  return null;
}

/** The link without a hash fragment or tracking parameters; the rest (e.g. ?variant=) is kept. */
export function cleanSiteLink(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|msclkid|_ga|srsltid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function keyOf(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

export interface SiteAnswerPick {
  /** The page to keep, or null when nothing in the answer is a product page on the site. */
  page: { url: string; title: string } | null;
  /** Links the search returned in total (answer and cited pages, de-duplicated). */
  considered: number;
  /** Dropped links by reason, for the "not found" note. */
  dropped: Partial<Record<SiteLinkProblem, number>>;
}

/**
 * Chooses the one page. Candidates are the links in the answer (any JSON it
 * still gave, markdown links, plain links) and the pages Google cited. A page
 * that is both named and cited comes first, then cited pages in Google's order
 * (real by construction), then pages only named in the answer. Only the first
 * valid one is kept: the owner asked for the item's page, and a second guess
 * would be a wrong page as often as a right one.
 */
export function pickSitePage(
  texts: string[],
  referenceLinks: GoogleAiModeReferenceLink[],
  domain: string
): SiteAnswerPick {
  const named = [
    ...parseBestSourceAnswer(texts).sources.map((s) => ({ url: s.url, title: s.title })),
    ...harvestSourceCandidates(texts, []).map((s) => ({ url: s.url, title: s.title })),
  ];
  const cited = referenceLinks.map((ref) => ({ url: ref.link, title: ref.title }));
  const citedKeys = new Set(cited.map((c) => keyOf(c.url)));

  const dropped: Partial<Record<SiteLinkProblem, number>> = {};
  const seen = new Set<string>();
  const valid = (list: Array<{ url: string; title?: string }>) => {
    const out: Array<{ url: string; title?: string }> = [];
    for (const item of list) {
      const key = keyOf(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      const problem = siteLinkProblem(item.url, domain);
      if (problem) dropped[problem] = (dropped[problem] ?? 0) + 1;
      else out.push(item);
    }
    return out;
  };

  const namedAndCited = valid(named.filter((n) => citedKeys.has(keyOf(n.url))));
  const citedOnly = valid(cited);
  const namedOnly = valid(named.filter((n) => !citedKeys.has(keyOf(n.url))));
  const best = [...namedAndCited, ...citedOnly, ...namedOnly][0];
  const titleOf = (url: string, own?: string) =>
    cleanPageTitle(cited.find((c) => keyOf(c.url) === keyOf(url))?.title ?? own) || domain;

  return {
    page: best ? { url: cleanSiteLink(best.url), title: titleOf(best.url, best.title) } : null,
    considered: seen.size,
    dropped,
  };
}

const PROBLEM_LABELS: Record<SiteLinkProblem, string> = {
  not_a_link: "not a link",
  other_site: "on another website",
  homepage: "the home page",
  listing_page: "a category or search page",
};

/** "returned 3 links, none a product page on shop.com (1 the home page, 2 on another website)". */
export function describeSiteMiss(pick: SiteAnswerPick, domain: string): string {
  if (pick.considered === 0) return "returned no pages";
  const reasons = (Object.keys(PROBLEM_LABELS) as SiteLinkProblem[])
    .filter((problem) => (pick.dropped[problem] ?? 0) > 0)
    .map((problem) => `${pick.dropped[problem]} ${PROBLEM_LABELS[problem]}`)
    .join(", ");
  return `returned ${pick.considered} link${pick.considered === 1 ? "" : "s"}, none a product page on ${domain}${reasons ? ` (${reasons})` : ""}`;
}

