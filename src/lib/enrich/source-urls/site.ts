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
 *  - the query is one sentence built from the fields the row has;
 *  - no JSON is requested: the page is taken from the cited pages and the links
 *    in the answer, and the `{url, title}` sources are built here in code;
 *  - a page is kept only if it is on the requested website and is a page for
 *    one product (not the homepage, a category or a search page). Anything else
 *    gets one simpler second search, then "not found" — never a homepage.
 *
 * Pure (no runtime imports beyond helpers), so it is cheap to test.
 */
import { DEFAULT_SOURCE_URLS_INSTRUCTION } from "@/types";
import { hostMatchesDomain, normalizeDomain } from "../domains";
import type { GoogleAiModeReferenceLink } from "../image-finder/exact/searchapi";
import { cleanPageTitle, harvestSourceCandidates, parseBestSourceAnswer } from "./skill";

/** The owner's extra instruction is a short note in this mode; the rest is cut. */
export const SITE_INSTRUCTION_MAX_CHARS = 300;

const MAX_DESCRIPTION_CHARS = 160;
const MAX_IDENTIFIER_CHARS = 40;

export type SiteSearchAttempt = 1 | 2;

/** The website setting as a bare domain, or null when empty or not a website. */
export function siteDomainOf(setting: string | undefined | null): string | null {
  return normalizeDomain(String(setting ?? ""));
}

// ---------------------------------------------------------------------------
// Which row fields describe the item
// ---------------------------------------------------------------------------

export interface SiteProductFields {
  description: string;
  barcode: string;
  sku: string;
  size: string;
}

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

type RowEntry = { key: string; value: string };

function rowEntries(rowData: Record<string, string>): RowEntry[] {
  const entries: RowEntry[] = [];
  for (const [key, raw] of Object.entries(rowData)) {
    const value = plain(raw);
    if (value && !isImageValue(value)) entries.push({ key: key.trim(), value });
  }
  return entries;
}

/** First entry whose header matches the earliest pattern in `patterns` and whose value passes `accept`. */
function pick(entries: RowEntry[], patterns: RegExp[], accept: (value: string) => boolean): string {
  for (const pattern of patterns) {
    const found = entries.find((entry) => pattern.test(entry.key) && accept(entry.value));
    if (found) return found.value;
  }
  return "";
}

const BARCODE_HEADERS = [/bar\s*-?code/i, /\b(ean|upc|gtin|isbn)\s*-?\d*\b/i];
const SKU_HEADERS = [
  /^\s*sku\b|\bsku\s*(code|no\.?|number)?\s*$/i,
  /\b(item|product|article)\s*(code|no\.?|number|#|id)\b/i,
  /\b(mpn|part\s*(no\.?|number|#))\b/i,
  /\b(model|style)(\s*(no\.?|number|code))?\b/i,
  /^\s*(code|ref(erence)?)\s*$/i,
];
const NAME_HEADERS = [
  /^\s*(product\s*)?(name|title)\s*$/i,
  /\b(product|item)\s*(name|title)\b/i,
  /^\s*(item\s*)?desc(ription)?\s*$/i,
  /\bdesc(ription)?\b/i,
  /\b(name|title)\b/i,
];
const SIZE_HEADERS = [/^\s*(size|sizes)\s*$/i, /\bsize\b/i];
const BRAND_HEADERS = [/^\s*(brand|manufacturer|vendor|maker)\s*$/i];

function cutAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/**
 * Finds the description, barcode, SKU and size in a row by their column names
 * (Description / Title / Name, Barcode / EAN / UPC / GTIN, SKU / Item code /
 * Model, Size). A field the row does not have stays empty and is left out of
 * the query. With no description column at all, the first few text values stand
 * in for one so the search still has the item's name.
 */
export function identifySiteProductFields(rowData: Record<string, string>): SiteProductFields {
  const entries = rowEntries(rowData);

  const barcodeRaw = pick(entries, BARCODE_HEADERS, (v) => /^\d[\d\s-]{6,}\d$/.test(v));
  const barcode = barcodeRaw.replace(/\D/g, "");
  const validBarcode = barcode.length >= 8 && barcode.length <= 14 ? barcode : "";
  const sku = pick(entries, SKU_HEADERS, (v) => v.length <= MAX_IDENTIFIER_CHARS && v.replace(/\D/g, "") !== validBarcode);
  const size = pick(entries, SIZE_HEADERS, (v) => v.length <= 30);
  const brand = pick(entries, BRAND_HEADERS, (v) => v.length <= 60);
  let description = pick(entries, NAME_HEADERS, (v) => /[a-z]/i.test(v));

  if (!description) {
    description = entries
      .map((entry) => entry.value)
      .filter((value) => /[a-z]/i.test(value) && value !== sku && value !== size)
      .slice(0, 3)
      .join(" ");
  }
  description = cutAtWord(description, MAX_DESCRIPTION_CHARS);
  // A brand that the name does not already carry tells a multi-brand shop which product is meant.
  if (brand && description && !description.toLowerCase().includes(brand.toLowerCase())) {
    description = `${brand} ${description}`;
  }
  return { description, barcode: validBarcode, sku, size };
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

export interface BuildSiteQueryInput {
  rowData: Record<string, string>;
  /** Bare domain, e.g. "mamasandpapas.com". */
  domain: string;
  customInstruction?: string;
  hasImage?: boolean;
  /** 1 = the full request; 2 = the simpler one (description and barcode only). Defaults to 1. */
  attempt?: SiteSearchAttempt;
}

/** The owner's note for this mode: skipped when it is only the default text, which asks for retailers. */
export function siteInstructionOf(customInstruction: string | undefined): string {
  const text = plain(customInstruction);
  if (!text || text === plain(DEFAULT_SOURCE_URLS_INSTRUCTION)) return "";
  return cutAtWord(text, SITE_INSTRUCTION_MAX_CHARS);
}

/**
 * `{domain} product page {description}, barcode {barcode}, SKU {sku} ({size}).
 * Return the {domain} product page link only.` Only fields the row has appear.
 * Attempt 2 keeps the description and barcode and drops everything else.
 * Returns "" when attempt 2 would ask the same thing as attempt 1 (nothing to
 * simplify), so no second search is paid for.
 */
export function buildSiteSourceUrlsQuery(input: BuildSiteQueryInput): string {
  const attempt = input.attempt ?? 1;
  const fields = identifySiteProductFields(input.rowData);
  const { domain } = input;

  const compose = (parts: { sku: boolean; size: boolean }): string => {
    const head = `${domain} product page${fields.description ? ` ${fields.description}` : ""}`;
    const ids: string[] = [];
    if (fields.barcode) ids.push(`barcode ${fields.barcode}`);
    if (parts.sku && fields.sku) ids.push(`SKU ${fields.sku}`);
    const size = parts.size && fields.size ? ` (${fields.size})` : "";
    return `${head}${ids.length > 0 ? `, ${ids.join(", ")}` : ""}${size}. Return the ${domain} product page link only.`;
  };

  if (attempt === 2) {
    if (!fields.description && !fields.barcode) return "";
    const simple = compose({ sku: false, size: false });
    return simple === compose({ sku: true, size: true }) && !siteInstructionOf(input.customInstruction) && !input.hasImage
      ? ""
      : simple;
  }

  const lines = [compose({ sku: true, size: true })];
  if (input.hasImage) lines[0] += " The attached photo shows the product.";
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
