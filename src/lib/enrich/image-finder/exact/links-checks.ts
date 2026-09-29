/**
 * Code-side checks on Agent 1's (Google AI Mode) link candidates. The skill
 * prompt (links-skill.ts) already asks for exact matches only, but testing
 * showed it does not always comply: bare domains instead of product URLs,
 * dead shops, datasheet-aggregator pages, and one instance of a suffix
 * variant (AN6326N) returned despite the instruction to reject it. These
 * checks catch what the prompt alone did not. Pure (no runtime imports) so
 * it is cheap to test.
 */
import { EXACT_LINKS_MAX, type ExactLinkCandidate } from "./links-skill";

export interface CheckedExactLink {
  url: string;
  site: string;
  matchedOn: string;
  evidence: string;
  differences: string;
}

/**
 * Reference/aggregator sites seen returning a page that genuinely names the
 * part but is not a page selling or presenting that ONE product — datasheet
 * hosts, multi-part catalogue lists, tube/component reference wikis, and
 * search engines the model sometimes echoes back as a "result".
 */
const NON_PRODUCT_HOST_PATTERNS: RegExp[] = [
  /(^|\.)datasheet4?u?\.com$/i,
  /(^|\.)alldatasheet\.com$/i,
  /(^|\.)datasheetarchive\.com$/i,
  /(^|\.)datasheetspdf\.com$/i,
  /(^|\.)electronicsupplycorp\.com$/i,
  /(^|\.)radiomuseum\.org$/i,
  /(^|\.)google\.[a-z.]+$/i,
  /(^|\.)bing\.com$/i,
];

/**
 * A full product URL, not a bare domain. A bare domain (`https://shop.com`
 * or `https://shop.com/`) names a shop, not a specific page — Google AI Mode
 * returned exactly this shape ("footshop.com", "gohailo.com") for links it
 * could describe but not actually point to.
 */
function fullProductUrl(raw: string): { ok: boolean; host?: string } {
  const trimmed = raw.trim();
  if (!/^https:\/\//i.test(trimmed)) return { ok: false };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false };
  }
  if (!url.pathname || url.pathname === "/") return { ok: false };
  return { ok: true, host: url.hostname.toLowerCase().replace(/^www\./, "") };
}

function isNonProductHost(host: string): boolean {
  return NON_PRODUCT_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * True when the quoted evidence shows the identifier immediately followed by
 * exactly one extra letter/digit and then a clear boundary — "AN6326N " or
 * "(AN253P)" (a real suffix/prefix variant) — without misfiring on the raw
 * text's own concatenation noise, e.g. "AN7312Go to product viewer dialog"
 * (no space between the code and unrelated UI text), where the character
 * after the one extra letter is still alphanumeric and so is not a boundary.
 */
function evidenceShowsVariant(evidence: string, identifiers: string[]): boolean {
  if (!evidence) return false;
  return identifiers.some((identifier) => {
    const trimmed = identifier.trim();
    if (!trimmed) return false;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escaped}[A-Za-z0-9](?![A-Za-z0-9])`, "i");
    return pattern.test(evidence);
  });
}

/**
 * Applies every check and caps the result at `maxLinks`, best first (input
 * order, since Agent 1 is asked to return its links best-first already).
 */
export function checkExactLinks(
  candidates: ExactLinkCandidate[],
  identifiers: string[],
  maxLinks = EXACT_LINKS_MAX
): CheckedExactLink[] {
  const out: CheckedExactLink[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (out.length >= maxLinks) break;
    const { ok, host } = fullProductUrl(candidate.url ?? "");
    if (!ok || !host) continue;
    if (isNonProductHost(host)) continue;
    if (evidenceShowsVariant(candidate.evidence ?? "", identifiers)) continue;

    const key = candidate.url.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      url: candidate.url.trim(),
      site: candidate.site?.trim() || host,
      matchedOn: candidate.matchedOn ?? "",
      evidence: candidate.evidence ?? "",
      differences: candidate.differences ?? "",
    });
  }

  return out;
}
