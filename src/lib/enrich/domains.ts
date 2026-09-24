/**
 * Website allow / block lists for the Image Finder. Mirrors OpenAI web_search
 * `filters`: bare domains (no scheme), subdomains included, at most 100 each.
 * Pure so the sidebar and the server share one set of rules.
 */

export const MAX_DOMAIN_RULES = 100;

export interface DomainRules {
  allowedDomains: string[];
  blockedDomains: string[];
}

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_PATTERN = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*\\.[a-z][a-z0-9-]*[a-z0-9]$`);

/** "https://www.LEGO.com/en-us/" → "lego.com"; returns null for anything that is not a domain. */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.replace(/:\d+$/, "").replace(/^\*\./, "").replace(/^www\./, "").replace(/\.$/, "");
  return DOMAIN_PATTERN.test(value) ? value : null;
}

/** Parse free text (one per line, or comma / space separated) into clean, unique domains. */
export function parseDomainList(text: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const entry of text.split(/[\s,;]+/)) {
    if (!entry.trim()) continue;
    const domain = normalizeDomain(entry);
    if (!domain) {
      invalid.push(entry.trim());
      continue;
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return { domains, invalid };
}

/** Server-side guard: never trust the client's list shape or size. */
export function sanitizeDomainList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const domain = normalizeDomain(item);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= MAX_DOMAIN_RULES) break;
  }
  return out;
}

export function sanitizeDomainRules(rules: {
  allowedDomains?: unknown;
  blockedDomains?: unknown;
}): DomainRules {
  const blockedDomains = sanitizeDomainList(rules.blockedDomains);
  const blocked = new Set(blockedDomains);
  return {
    allowedDomains: sanitizeDomainList(rules.allowedDomains).filter((d) => !blocked.has(d)),
    blockedDomains,
  };
}

export function hasDomainRules(rules: DomainRules): boolean {
  return rules.allowedDomains.length > 0 || rules.blockedDomains.length > 0;
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** True when `host` is `domain` or one of its subdomains. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Hard guarantee on top of the OpenAI filter: an image is kept only if its
 * page or file host is on the allow list (when set), and neither host is blocked.
 */
export function filterImagesByDomainRules<T extends { imageUrl: string; pageUrl?: string }>(
  images: T[],
  rules: DomainRules
): T[] {
  if (!hasDomainRules(rules)) return images;
  return images.filter((image) => {
    const hosts = [hostOf(image.pageUrl), hostOf(image.imageUrl)].filter(Boolean);
    if (hosts.length === 0) return false;
    const blocked = hosts.some((host) =>
      rules.blockedDomains.some((domain) => hostMatchesDomain(host, domain))
    );
    if (blocked) return false;
    if (rules.allowedDomains.length === 0) return true;
    return hosts.some((host) =>
      rules.allowedDomains.some((domain) => hostMatchesDomain(host, domain))
    );
  });
}
