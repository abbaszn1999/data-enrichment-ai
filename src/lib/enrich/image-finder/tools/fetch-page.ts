import { hostMatchesDomain, type DomainRules } from "../../domains";
import type { EnrichFunctionTool } from "../../openai";
import type { EvidenceLedger } from "../evidence";
import {
  identifiersSeenIn,
  nearIdentifiersSeenIn,
  normalizeMatchText,
  type NearCodeMatch,
  type RowIdentifier,
} from "./identifiers";
import { extractHtmlPage, extractJsonPage, type PageExtract } from "./page-extract";
import { readCapped, safeFetch, UnsafeUrlError } from "./url-safety";

export const FETCH_PAGE_TOOL_NAME = "fetch_page";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3_000_000;
const DEFAULT_MAX_FETCHES = 60;
/** Pages per website per product: enough for its search and product pages, not endless catalogue browsing. */
const DEFAULT_MAX_FETCHES_PER_SITE = 20;
const PER_HOST_GAP_MS = 400;
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 400;
const MAX_TEXT_OUT = 2_500;
const MAX_LINKS_OUT = 45;
const MAX_IMAGES_OUT = 30;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export interface CachedPage {
  at: number;
  status: number;
  finalUrl: string;
  extract: PageExtract | null;
  /** Full body text used for identifier detection (scripts included). */
  body: string;
  error?: string;
}

// Shared across rows in the same worker process: rows of one sheet often open
// the same store search and category pages.
const pageCache = new Map<string, CachedPage>();
const hostLastRequest = new Map<string, number>();

function cacheGet(url: string): CachedPage | undefined {
  const hit = pageCache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    pageCache.delete(url);
    return undefined;
  }
  return hit;
}

function cacheSet(url: string, page: CachedPage): void {
  pageCache.set(url, page);
  if (pageCache.size > CACHE_MAX) {
    const oldest = pageCache.keys().next().value;
    if (oldest) pageCache.delete(oldest);
  }
}

async function politeDelay(host: string): Promise<void> {
  const last = hostLastRequest.get(host) ?? 0;
  const wait = last + PER_HOST_GAP_MS - Date.now();
  hostLastRequest.set(host, Math.max(Date.now(), last + PER_HOST_GAP_MS));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export async function loadPage(url: string): Promise<CachedPage> {
  const cached = cacheGet(url);
  if (cached) return cached;
  let page: CachedPage;
  try {
    await politeDelay(new URL(url).hostname);
    const { response, finalUrl } = await safeFetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const buffer = await readCapped(response, MAX_PAGE_BYTES, { truncate: true });
    const body = buffer ? buffer.toString("utf8") : "";
    const isJson = contentType.includes("json") || /^\s*[[{]/.test(body.slice(0, 20));
    const isHtml = contentType.includes("html") || contentType.includes("xml") || /<html|<body|<head/i.test(body.slice(0, 2000));
    const extract = !response.ok || !body
      ? null
      : isJson
        ? extractJsonPage(body, finalUrl)
        : isHtml || contentType.startsWith("text/")
          ? extractHtmlPage(body, finalUrl)
          : null;
    page = {
      at: Date.now(),
      status: response.status,
      finalUrl,
      extract,
      body,
      error: extract || !response.ok ? undefined : `Unsupported content type: ${contentType || "unknown"}`,
    };
  } catch (error) {
    page = {
      at: Date.now(),
      status: 0,
      finalUrl: url,
      extract: null,
      body: "",
      error:
        error instanceof UnsafeUrlError
          ? error.message
          : error instanceof Error && error.name === "TimeoutError"
            ? "Timed out"
            : `Could not open: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  cacheSet(url, page);
  return page;
}

function withinRules(url: string, rules: DomainRules): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Not a valid URL";
  }
  if (rules.blockedDomains.some((domain) => hostMatchesDomain(host, domain))) {
    return "This website is blocked by the store owner's website rules.";
  }
  if (rules.allowedDomains.length > 0 && !rules.allowedDomains.some((domain) => hostMatchesDomain(host, domain))) {
    return "This website is outside the store owner's allowed websites.";
  }
  return null;
}

export interface PageSessionOptions {
  rowIdentifiers: RowIdentifier[];
  ledger: EvidenceLedger;
  domainRules: DomainRules;
  maxFetches?: number;
  maxFetchesPerSite?: number;
  load?: (url: string) => Promise<CachedPage>;
}

export type OpenedPage =
  | { url: string; refused: string }
  | { url: string; refused?: undefined; page: CachedPage; seen: RowIdentifier[]; near: NearCodeMatch[] };

/**
 * One row's page access, shared by fetch_page and check_pages: website rules,
 * the per-row and per-site page budgets, and evidence recording all live
 * here, so both tools obey the same limits and feed the same ledger.
 */
export interface PageSession {
  open(url: string): Promise<OpenedPage>;
  pagesLeft(): number;
}

function pageMatchText(extract: PageExtract | null): string {
  if (!extract) return "";
  return normalizeMatchText(`${extract.title} ${extract.productText}`);
}

export function createPageSession(input: PageSessionOptions): PageSession {
  const maxFetches = input.maxFetches ?? DEFAULT_MAX_FETCHES;
  const maxPerSite = input.maxFetchesPerSite ?? DEFAULT_MAX_FETCHES_PER_SITE;
  const load = input.load ?? loadPage;
  let fetches = 0;
  const perSite = new Map<string, number>();
  return {
    pagesLeft: () => Math.max(0, maxFetches - fetches),
    open: async (rawUrl) => {
      const url = rawUrl.trim();
      const ruleError = withinRules(url, input.domainRules);
      if (ruleError) return { url, refused: ruleError };
      if (fetches >= maxFetches) {
        return { url, refused: "Page budget for this product is used up. Answer with what you have verified." };
      }
      const site = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      const siteCount = perSite.get(site) ?? 0;
      if (siteCount >= maxPerSite) {
        return {
          url,
          refused: `You have opened ${siteCount} pages on ${site} for this product. Rely on its own site search results, or move to other sources.`,
        };
      }
      perSite.set(site, siteCount + 1);
      fetches += 1;
      const page = await load(url);
      const seen = identifiersSeenIn(page.body, input.rowIdentifiers);
      const near = nearIdentifiersSeenIn(page.body, input.rowIdentifiers);
      input.ledger.recordPage({
        url,
        finalUrl: page.finalUrl,
        status: page.status,
        identifiers: seen,
        imageUrls: page.extract?.images ?? [],
        nearCodes: near,
        matchText: pageMatchText(page.extract),
      });
      return { url, page, seen, near };
    },
  };
}

export function createFetchPageTool(session: PageSession): EnrichFunctionTool {
  return {
    name: FETCH_PAGE_TOOL_NAME,
    description:
      "Open one web page or JSON URL live and read it in full: a product page, a store's own search results page (use its search form template), a category or collection page, a manufacturer page, or a page's structured data (for example a product URL with .json or .js appended). Returns the title, visible text, links, every image link, structured product data (SKU, MPN, GTIN/barcode, brand, price, images) and which of this row's identifiers appear on the page.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "Full http(s) URL to open." },
      },
      required: ["url"],
    },
    run: async (args) => {
      const opened = await session.open(String(args.url ?? ""));
      if (opened.refused !== undefined) return JSON.stringify({ url: opened.url, error: opened.refused });
      const { url, page, seen, near } = opened;
      if (!page.extract) {
        return JSON.stringify({
          url,
          finalUrl: page.finalUrl,
          status: page.status,
          error: page.error ?? `The page returned HTTP ${page.status}.`,
        });
      }
      return JSON.stringify({
        url,
        finalUrl: page.finalUrl,
        status: page.status,
        title: page.extract.title,
        rowIdentifiersSeen: seen.map((identifier) => identifier.value),
        nearCodesSeen: near.map((match) => match.pageCode),
        structuredProducts: page.extract.products,
        searchForms: page.extract.searchForms,
        // Kept compact: every tool output is re-read on each later round.
        images: page.extract.images.slice(0, MAX_IMAGES_OUT),
        links: page.extract.links.slice(0, MAX_LINKS_OUT),
        text: page.extract.text.slice(0, MAX_TEXT_OUT),
        pagesLeftForThisProduct: session.pagesLeft(),
      });
    },
  };
}

/** Test hook: clears the process-wide page cache and per-host pacing. */
export function resetFetchPageStateForTests(): void {
  pageCache.clear();
  hostLastRequest.clear();
}
