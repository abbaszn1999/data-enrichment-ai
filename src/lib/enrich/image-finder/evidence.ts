import type { NearCodeMatch, RowIdentifier } from "./tools/identifiers";

/**
 * What our own tools actually saw during one row's research. The model's
 * final answer is only accepted where this record backs it up: the verified
 * page was really opened and really shows the identifier, and every image
 * link really appeared on a verified page of the same item.
 */

export interface PageEvidence {
  url: string;
  finalUrl: string;
  status: number;
  /** Normalized keys of row identifiers seen in the page body or structured data. */
  identifierKeys: Set<string>;
  /** normalizeImageKey() of every image link found on the page. */
  imageKeys: Set<string>;
  /** Distinctive image filenames on the page (see imageFileKey). */
  imageFiles: Set<string>;
  /** `ROWKEY>PAGECODE` for page codes one or two trailing letters away from a row code (see nearIdentifiersSeenIn). */
  nearCodes: Set<string>;
  /** normalizeMatchText() of the page's title, structured product names/brands and visible text. */
  matchText: string;
}

const MAX_MATCH_TEXT = 20_000;

export function nearCodeKey(rowKey: string, pageCode: string): string {
  return `${rowKey}>${pageCode}`;
}

/** Registrable-ish site of a page (host without `www.`), used to count independent sources. */
export function pageSite(evidence: PageEvidence): string {
  try {
    return new URL(evidence.finalUrl || evidence.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return evidence.url;
  }
}

const SIZE_PARAMS = new Set([
  "width", "height", "w", "h", "size", "quality", "q", "fit", "crop", "format", "fm", "auto", "dpr", "v", "resize", "scale",
]);
const SIZE_SUFFIX =
  /(?:_(?:\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:@\dx)?|-\d+x\d+|-scaled)(?=\.[a-z0-9]+$)/i;

/** Page key: host + path without trailing slash, query kept, hash dropped. Product `.json`/`.js` views map to their page. */
export function normalizePageKey(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/(\/products\/[^/]+)\.(json|js)$/i, "$1").replace(/\/+$/, "") || "/";
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path}${url.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

function pageKeyWithoutQuery(key: string): string {
  const index = key.indexOf("?");
  return index === -1 ? key : key.slice(0, index);
}

/** Same image regardless of requested size/format: size query params and size suffixes removed. */
export function normalizeImageKey(raw: string): string {
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    for (const key of [...url.searchParams.keys()]) {
      if (SIZE_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    const path = url.pathname.replace(SIZE_SUFFIX, "");
    const query = url.searchParams.toString();
    return `${url.hostname.toLowerCase()}${path}${query ? `?${query}` : ""}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Filename key used to match the same file served from two hosts (a store's
 * own domain and its CDN). Only distinctive names count, so generic names like
 * `image1.jpg` never cause a cross-site match.
 */
export function imageFileKey(raw: string): string | null {
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    const file = decodeURIComponent(url.pathname.split("/").pop() ?? "")
      .replace(SIZE_SUFFIX, "")
      .toLowerCase();
    const stem = file.replace(/\.[a-z0-9]+$/, "");
    if (stem.length < 12 || !/\d/.test(stem)) return null;
    return file;
  } catch {
    return null;
  }
}

export class EvidenceLedger {
  private readonly pages = new Map<string, PageEvidence>();

  recordPage(input: {
    url: string;
    finalUrl: string;
    status: number;
    identifiers: RowIdentifier[];
    imageUrls: string[];
    nearCodes?: NearCodeMatch[];
    matchText?: string;
  }): PageEvidence {
    const evidence: PageEvidence = {
      url: input.url,
      finalUrl: input.finalUrl,
      status: input.status,
      identifierKeys: new Set(input.identifiers.map((identifier) => identifier.key)),
      imageKeys: new Set(input.imageUrls.map(normalizeImageKey)),
      imageFiles: new Set(input.imageUrls.map(imageFileKey).filter((key): key is string => Boolean(key))),
      nearCodes: new Set((input.nearCodes ?? []).map((near) => nearCodeKey(near.rowKey, near.pageCode))),
      matchText: (input.matchText ?? "").slice(0, MAX_MATCH_TEXT),
    };
    for (const raw of [input.url, input.finalUrl]) {
      const key = normalizePageKey(raw);
      const existing = this.pages.get(key);
      this.pages.set(key, existing ? mergeEvidence(existing, evidence) : evidence);
    }
    return evidence;
  }

  /** The evidence for a page the agent cites, matching its `.json` view or the URL without query string. */
  find(pageUrl: string): PageEvidence | undefined {
    const key = normalizePageKey(pageUrl);
    return this.pages.get(key) ?? this.pages.get(pageKeyWithoutQuery(key));
  }

  get size(): number {
    return this.pages.size;
  }

  /** Every recorded page once (a page stored under both its URL and final URL counts once). */
  all(): PageEvidence[] {
    return [...new Set(this.pages.values())];
  }
}

function mergeEvidence(a: PageEvidence, b: PageEvidence): PageEvidence {
  return {
    url: a.url,
    finalUrl: a.finalUrl,
    status: a.status >= 200 && a.status < 300 ? a.status : b.status,
    identifierKeys: new Set([...a.identifierKeys, ...b.identifierKeys]),
    imageKeys: new Set([...a.imageKeys, ...b.imageKeys]),
    imageFiles: new Set([...a.imageFiles, ...b.imageFiles]),
    nearCodes: new Set([...a.nearCodes, ...b.nearCodes]),
    matchText: a.matchText === b.matchText ? a.matchText : `${a.matchText}${b.matchText}`.slice(0, MAX_MATCH_TEXT),
  };
}

export function isOkPage(evidence: PageEvidence | undefined): evidence is PageEvidence {
  return Boolean(evidence && evidence.status >= 200 && evidence.status < 300);
}

export function pageShowsImage(evidence: PageEvidence, imageUrl: string): boolean {
  if (evidence.imageKeys.has(normalizeImageKey(imageUrl))) return true;
  const file = imageFileKey(imageUrl);
  return Boolean(file && evidence.imageFiles.has(file));
}
