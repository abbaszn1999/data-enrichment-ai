/**
 * Turns the pages Google Lens returned into the three lists a row keeps:
 *
 * - kept: the best pages, at most `limit` and at most two per website, best
 *   first. Only this list feeds other columns.
 * - also found: good pages that did not fit, for review in the cell's popup.
 * - set aside: pages removed as certainly not a product page, each with its
 *   reason, so a wrong removal is visible.
 *
 * Everything is capped (see side-keys.ts) so a row stays small on sheets with
 * thousands of rows, and the work per row is one pass plus one sort of the
 * pages Google returned.
 */
import { cleanPageTitle } from "../source-urls/skill";
import { hostMatchesDomain, type DomainRules } from "../domains";
import type { SourceUrl } from "@/types";
import { classifyLensLink, type LensRowContext } from "./product-links";
import type { LensMatch } from "./searchapi-lens";
import {
  LENS_ALSO_FOUND_MAX,
  LENS_EXTRA_TITLE_MAX,
  LENS_SET_ASIDE_MAX,
  LENS_SET_ASIDE_URI_MAX,
  type LensSetAside,
} from "./side-keys";

/** Most pages one website may take in a row's kept list. */
export const LENS_PER_SITE_MAX = 2;

/** How many listed pages were set aside, and why. */
export interface LensDrops {
  /** Video, social, reference and stock-photo websites. */
  site: number;
  /** Category, review, article and search pages. */
  listing: number;
  /** Home pages and files that are not a page about one product. */
  notPage: number;
  /** Blocked or not allowed by the owner's website rules. */
  rules: number;
}

export const emptyLensDrops = (): LensDrops => ({ site: 0, listing: 0, notPage: 0, rules: 0 });

export interface LensSelection {
  kept: SourceUrl[];
  alsoFound: SourceUrl[];
  setAside: LensSetAside[];
  drops: LensDrops;
  /** Page keys already placed in kept or also found, so a second list continues the first. */
  seen: Set<string>;
}

export const newLensSelection = (): LensSelection => ({
  kept: [],
  alsoFound: [],
  setAside: [],
  drops: emptyLensDrops(),
  seen: new Set(),
});

export interface SelectLensPagesOptions {
  rules: DomainRules;
  limit: number;
  /** Remove what is not a product page, rank the rest, and spread across websites. Default on. */
  productsOnly?: boolean;
  row?: LensRowContext;
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Host plus path without trailing slash; the query and hash do not make a page different. */
function pageKey(raw: string): string {
  try {
    const url = new URL(raw);
    return `${hostOf(raw)}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "or", "ne", "go"]);
/** Hosts where each subdomain is a different store. */
const SHARED_PLATFORMS = new Set([
  "myshopify", "wixsite", "weebly", "wordpress", "blogspot", "squarespace", "bigcartel", "github", "netlify", "vercel",
]);

/** The website a page belongs to: amazon.ie, amazon.co.jp and www.amazon.com are all "amazon". */
export function siteOf(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return parts[0] ?? host;
  const tld = parts[parts.length - 1]!;
  const label = parts[parts.length - 2]!;
  if (SHARED_PLATFORMS.has(label)) return parts.slice(-3).join(".");
  if (tld.length === 2 && SECOND_LEVEL_LABELS.has(label)) return parts[parts.length - 3]!;
  return label;
}

interface Candidate {
  entry: SourceUrl;
  key: string;
  site: string;
  score: number;
  order: number;
}

/**
 * Adds one list of Lens pages to the selection. Rules (your allow and block
 * lists) apply first, then the product check, then ranking and the per-site
 * limit. With `productsOnly` off the pages keep Google's order and nothing is
 * removed or spread across websites.
 */
export function selectLensPages(matches: LensMatch[], selection: LensSelection, options: SelectLensPagesOptions): void {
  const productsOnly = options.productsOnly !== false;
  const { rules, limit } = options;
  const { drops } = selection;
  const candidates: Candidate[] = [];
  const listed = new Set<string>();

  matches.forEach((match, order) => {
    const host = hostOf(match.link);
    if (!host) return;
    if (
      rules.blockedDomains.some((domain) => hostMatchesDomain(host, domain)) ||
      (rules.allowedDomains.length > 0 && !rules.allowedDomains.some((domain) => hostMatchesDomain(host, domain)))
    ) {
      drops.rules += 1;
      return;
    }
    let score = 0;
    let note = "";
    if (productsOnly) {
      const verdict = classifyLensLink(match, options.row);
      if (verdict.remove) {
        if (verdict.remove === "site") drops.site += 1;
        else if (verdict.remove === "listing") drops.listing += 1;
        else drops.notPage += 1;
        if (selection.setAside.length < LENS_SET_ASIDE_MAX) {
          selection.setAside.push({ uri: match.link.slice(0, LENS_SET_ASIDE_URI_MAX), reason: verdict.remove });
        }
        return;
      }
      score = verdict.score;
      note = verdict.note;
    }
    const key = pageKey(match.link);
    if (selection.seen.has(key) || listed.has(key)) return;
    listed.add(key);
    const title = cleanPageTitle(match.title) || match.source || host;
    candidates.push({
      entry: { title, uri: match.link, ...(note ? { note } : {}) },
      key,
      site: siteOf(host),
      score,
      order,
    });
  });

  if (productsOnly) candidates.sort((a, b) => b.score - a.score || a.order - b.order);

  const perSite = new Map<string, number>();
  for (const page of selection.kept) {
    const site = siteOf(hostOf(page.uri));
    perSite.set(site, (perSite.get(site) ?? 0) + 1);
  }

  for (const candidate of candidates) {
    const used = perSite.get(candidate.site) ?? 0;
    if (selection.kept.length < limit && (!productsOnly || used < LENS_PER_SITE_MAX)) {
      selection.kept.push(candidate.entry);
      selection.seen.add(candidate.key);
      perSite.set(candidate.site, used + 1);
    } else if (selection.alsoFound.length < LENS_ALSO_FOUND_MAX) {
      selection.alsoFound.push({ ...candidate.entry, title: candidate.entry.title.slice(0, LENS_EXTRA_TITLE_MAX) });
      selection.seen.add(candidate.key);
    }
  }
}

/** "5 on video, social, reference or stock-photo sites, 3 category, review or article page(s)" — empty when nothing was set aside. */
export function describeLensDrops(drops: LensDrops): string {
  const parts: string[] = [];
  if (drops.site > 0) parts.push(`${drops.site} on video, social, reference or stock-photo sites`);
  if (drops.listing > 0) parts.push(`${drops.listing} category, review or article page(s)`);
  if (drops.notPage > 0) parts.push(`${drops.notPage} home page(s) or file(s)`);
  if (drops.rules > 0) parts.push(`${drops.rules} blocked by your website rules`);
  return parts.join(", ");
}
