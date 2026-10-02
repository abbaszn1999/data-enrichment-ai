import { hostMatchesDomain, type DomainRules } from "../domains";
import type { KnownPage } from "../types";

/** Pages from a Source URLs column that reach the image agent, best first. */
export const KNOWN_PAGES_MAX = 10;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The pages the image agent is told to open first: public http(s) links only,
 * no repeats, none on a blocked website, only allowed websites when the owner
 * set an allow list, and at most KNOWN_PAGES_MAX.
 */
export function prepareKnownPages(pages: KnownPage[] | undefined, rules: DomainRules): KnownPage[] {
  const seen = new Set<string>();
  const kept: KnownPage[] = [];
  for (const page of pages ?? []) {
    const url = page.url.trim();
    const host = hostOf(url);
    if (!/^https?:\/\//i.test(url) || !host) continue;
    const key = `${host}${new URL(url).pathname.replace(/\/+$/, "")}`;
    if (seen.has(key)) continue;
    if (rules.blockedDomains.some((domain) => hostMatchesDomain(host, domain))) continue;
    if (
      rules.allowedDomains.length > 0 &&
      !rules.allowedDomains.some((domain) => hostMatchesDomain(host, domain))
    ) {
      continue;
    }
    seen.add(key);
    kept.push(page.title ? { url, title: page.title } : { url });
    if (kept.length >= KNOWN_PAGES_MAX) break;
  }
  return kept;
}
