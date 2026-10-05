/**
 * Judges the pages Google Lens returns for a picture. Three outcomes, so a
 * real product page is never lost to a guess:
 *
 * - remove: certainly not a product page (video or reference sites, stock
 *   photos, files, marketplace search and category pages, review and article
 *   pages, spam home pages). Recorded with a reason, never silently lost.
 * - promote: Google lists a price, the URL is a product URL, or the page title
 *   shares words or a code with the row.
 * - demote: unsure (social sellers, brand or collection pages, search-like
 *   URLs). Kept, ranked below everything better.
 *
 * Matching the row only ever raises a page; a page in another language or with
 * a bare title is never pushed down for lacking the row's words.
 */
import { isNonProductHost } from "../image-finder/exact/links-checks";
import type { LensMatch } from "./searchapi-lens";

/** Why a page was removed: a video or reference site, a list/article page, or a home page or file. */
export type LensRemoveReason = "site" | "listing" | "not_page";

export interface LensLinkVerdict {
  remove?: LensRemoveReason;
  /** Higher is better. Only meaningful for pages that were not removed. */
  score: number;
  /** Short label shown next to the link: "Price €24", "Product page", "Matches your item", "Check". */
  note: string;
}

/** What the row says about its item, used to rank pages whose URL tells nothing. */
export interface LensRowContext {
  /** Barcodes and model codes, lowercased. */
  identifiers: string[];
  /** Distinctive words of the row's text, lowercased. */
  words: string[];
}

const PRICE_SCORE = 50;
const PRODUCT_PATH_SCORE = 30;
const SOFT_PENALTY = 25;
const SOCIAL_PENALTY = 30;
const IDENTIFIER_SCORE = 40;
const WORD_SCORE = 8;
const MAX_WORDS_COUNTED = 4;
const MAX_RELEVANCE = 72;
/** A home page is kept only when its title shows at least two of the row's words. */
const HOME_PAGE_MIN_RELEVANCE = 16;
const NOTE_RELEVANCE = 16;

/** Sellers do sell on these, so their pages are demoted, not removed. */
const SOCIAL_SELLER_HOSTS: RegExp[] = [
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)tiktok\.com$/i,
];

const EXTRA_NON_PRODUCT_HOSTS: RegExp[] = [
  /(^|\.)(x|twitter)\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)flickr\.com$/i,
  /(^|\.)imgur\.com$/i,
  /(^|\.)medium\.com$/i,
  /(^|\.)shutterstock\.com$/i,
  /(^|\.)istockphoto\.com$/i,
  /(^|\.)gettyimages\.[a-z.]+$/i,
  /(^|\.)alamy\.com$/i,
  /(^|\.)dreamstime\.com$/i,
  /(^|\.)depositphotos\.com$/i,
  /(^|\.)123rf\.com$/i,
  /(^|\.)freepik\.com$/i,
  /(^|\.)pngtree\.com$/i,
  /(^|\.)vecteezy\.com$/i,
  /(^|\.)archive\.org$/i,
];

/** Search and category pages of the big marketplaces: a list, never one product. */
const MARKETPLACE_LISTS: Array<{ host: RegExp; path: RegExp }> = [
  { host: /(^|\.)ebay\.[a-z.]+$/i, path: /^\/(sch|b|e|str|deals|shop|cln|sl|bhp)(\/|$)/i },
  { host: /(^|\.)amazon\.[a-z.]+$/i, path: /^\/(s|b|stores|hz|l)(\/|$)|^\/gp\/(browse|bestsellers|search)|\/(Best-Sellers|bestsellers)/i },
  { host: /(^|\.)walmart\.[a-z.]+$/i, path: /^\/(browse|search|cp|shop)(\/|$)/i },
  { host: /(^|\.)aliexpress\.[a-z.]+$/i, path: /^\/(w|af|category|wholesale|popular)(\/|$)/i },
  { host: /(^|\.)alibaba\.com$/i, path: /^\/(trade\/search|showroom|wholesale)/i },
  { host: /(^|\.)etsy\.com$/i, path: /^\/([a-z]{2}(-[a-z]{2})?\/)?(search|c|market|shop)(\/|$)/i },
  { host: /(^|\.)shopee\.[a-z.]+$/i, path: /^\/search|-cat\.\d+/i },
  { host: /(^|\.)(daraz|lazada)\.[a-z.]+$/i, path: /^\/(catalog|tag|shop)(\/|$)/i },
  { host: /(^|\.)temu\.com$/i, path: /search_result/i },
  { host: /(^|\.)noon\.com$/i, path: /\/search(\/|$)/i },
  { host: /^(listado|lista)\.mercadol(ibre|ivre)\./i, path: /.*/ },
];

const FILE_EXTENSION = /\.(pdf|jpe?g|png|gif|webp|avif|svg|bmp|mp4|mov|webm|mp3|zip)$/i;

const PRODUCT_SEGMENTS = new Set([
  "product", "products", "produkt", "produkty", "producto", "productos", "produto", "produtos",
  "produit", "produits", "prodotto", "prodotti", "proizvod", "proizvodi", "urun", "goods",
  "item", "items", "itm", "dp", "ip", "p", "pd", "sku", "listing", "up",
]);
const PRODUCT_SEGMENT_PREFIX = /^(product|produkt|producto|produit|prodotto|proizvod|item)[-_]/;
/** Starts like a product segment but names a list or a review page (WooCommerce categories, Amazon reviews). */
const PRODUCT_LIST_SEGMENT = /^products?[-_](category|categories|tag|tags|brand|brands|cat|reviews?|questions?|search)$/;

/** Pages that are articles, reviews or utility pages: removed unless Google lists a price. */
const CONTENT_SEGMENTS = new Set([
  "blog", "blogs", "news", "article", "articles", "video", "videos", "watch", "forum", "forums",
  "review", "reviews", "recenzie", "recenze", "recensione", "recensioni", "rezension", "rezensionen",
  "exhibitor", "exhibitors", "search", "cart", "checkout", "login", "signin", "account", "wishlist",
  "wiki", "questions", "faq", "help", "support", "about", "contact", "press", "stories", "gallery",
]);
/** Pages that may list products or may be one: kept, ranked lower. */
const AMBIGUOUS_LIST_SEGMENTS = new Set([
  "tag", "tags", "category", "categories", "collection", "collections", "brand", "brands",
  "manufacturer", "manufacturers", "vendor", "vendors",
]);

const SEARCH_PARAMS = ["q", "s", "search", "query", "keyword", "keywords", "page", "sort", "filter"];

function hasProductSegment(segments: string[]): boolean {
  if (segments.some((segment) => PRODUCT_LIST_SEGMENT.test(segment))) return false;
  return segments.some((segment) => PRODUCT_SEGMENTS.has(segment) || PRODUCT_SEGMENT_PREFIX.test(segment));
}

function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const STOP_WORDS = new Set([
  "the", "and", "with", "for", "from", "pcs", "pack", "new", "set", "kit", "size", "color", "colour", "item",
]);
const MAX_CONTEXT_WORDS = 30;
const MAX_CONTEXT_IDENTIFIERS = 10;

/** The row's codes and distinctive words, from every text cell that is not a link or a picture. */
export function buildLensRowContext(productData: Record<string, unknown> | undefined): LensRowContext | undefined {
  if (!productData) return undefined;
  const identifiers = new Set<string>();
  const words = new Set<string>();
  for (const raw of Object.values(productData)) {
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const value = String(raw).trim();
    if (!value || value.length > 300 || /^(https?:|vz-storage:|data:)/i.test(value)) continue;
    for (const token of normalizeText(value).split(/[^a-z0-9]+/)) {
      if (!token) continue;
      const isCode = /^\d{8,14}$/.test(token) || (token.length >= 5 && /\d/.test(token) && /[a-z]/.test(token));
      if (isCode) {
        if (identifiers.size < MAX_CONTEXT_IDENTIFIERS) identifiers.add(token);
      } else if (token.length >= 3 && !/^\d+$/.test(token) && !STOP_WORDS.has(token)) {
        if (words.size < MAX_CONTEXT_WORDS) words.add(token);
      }
    }
  }
  if (identifiers.size === 0 && words.size === 0) return undefined;
  return { identifiers: [...identifiers], words: [...words] };
}

function relevanceOf(match: { title?: string }, url: URL, context: LensRowContext | undefined): number {
  if (!context) return 0;
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // an undecodable path is still searched as-is
  }
  const haystack = normalizeText(`${match.title ?? ""} ${url.hostname} ${path}`);
  let score = context.identifiers.some((id) => haystack.includes(id)) ? IDENTIFIER_SCORE : 0;
  if (context.words.length >= 2) {
    const tokens = new Set(haystack.split(/[^a-z0-9]+/));
    const matched = context.words.filter((word) => tokens.has(word)).length;
    score += Math.min(matched, MAX_WORDS_COUNTED) * WORD_SCORE;
  }
  return Math.min(score, MAX_RELEVANCE);
}

function priceNote(price: string | undefined): string {
  const text = (price ?? "").replace(/\*+$/, "").trim();
  return text ? `Price ${text.slice(0, 20)}` : "In stock";
}

export function classifyLensLink(
  match: Pick<LensMatch, "link" | "price" | "inStock"> & { title?: string },
  context?: LensRowContext
): LensLinkVerdict {
  let url: URL;
  try {
    url = new URL(match.link);
  } catch {
    return { remove: "not_page", score: 0, note: "" };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const social = SOCIAL_SELLER_HOSTS.some((pattern) => pattern.test(host));
  if (!social && (isNonProductHost(host) || EXTRA_NON_PRODUCT_HOSTS.some((pattern) => pattern.test(host)))) {
    return { remove: "site", score: 0, note: "" };
  }

  const path = url.pathname.toLowerCase();
  if (FILE_EXTENSION.test(path)) return { remove: "not_page", score: 0, note: "" };

  const relevance = relevanceOf(match, url, context);
  const priced = Boolean(match.price || match.inStock);

  if (!path || path === "/") {
    if (priced) return { score: PRICE_SCORE + relevance - SOFT_PENALTY, note: priceNote(match.price) };
    if (relevance >= HOME_PAGE_MIN_RELEVANCE) return { score: relevance - SOFT_PENALTY, note: "Check" };
    return { remove: "not_page", score: 0, note: "" };
  }

  if (MARKETPLACE_LISTS.some((rule) => rule.host.test(host) && rule.path.test(url.pathname))) {
    return { remove: "listing", score: 0, note: "" };
  }

  const segments = path.split("/").filter(Boolean);
  const penalty = social ? SOCIAL_PENALTY : 0;

  if (priced) {
    return { score: PRICE_SCORE + relevance - penalty, note: priceNote(match.price) };
  }
  if (segments.some((segment) => PRODUCT_LIST_SEGMENT.test(segment))) {
    return { remove: "listing", score: 0, note: "" };
  }
  if (hasProductSegment(segments)) {
    return { score: PRODUCT_PATH_SCORE + relevance - penalty, note: social ? "Check" : "Product page" };
  }
  if (segments.some((segment) => CONTENT_SEGMENTS.has(segment))) return { remove: "listing", score: 0, note: "" };

  let softPenalty = penalty;
  if (segments.some((segment) => AMBIGUOUS_LIST_SEGMENTS.has(segment))) softPenalty += SOFT_PENALTY;
  if (SEARCH_PARAMS.some((param) => url.searchParams.has(param))) softPenalty += SOFT_PENALTY;

  const score = relevance - softPenalty;
  if (softPenalty > 0) return { score, note: "Check" };
  return { score, note: relevance >= NOTE_RELEVANCE ? "Matches your item" : "" };
}
