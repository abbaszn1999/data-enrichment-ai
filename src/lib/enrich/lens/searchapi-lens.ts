/**
 * SearchApi.io client for Google Lens. One call looks at one public image and
 * returns the pages Google matched to it. Billing is flat per search: a call
 * that answers HTTP 200 with a Success body is billed even when it found
 * nothing, a failed request is not (see requestSearchApi).
 */
import { requestSearchApi } from "../image-finder/exact/searchapi";

export type LensSearchType = "exact_matches" | "visual_matches";

export interface LensMatch {
  link: string;
  title: string;
  source?: string;
}

export interface GoogleLensResult {
  matches: LensMatch[];
  searchType: LensSearchType;
  httpStatus: number;
  elapsedMs: number;
}

interface LensApiMatch {
  link?: unknown;
  title?: unknown;
  source?: unknown;
}

interface LensApiResponse {
  search_metadata?: { status?: string };
  exact_matches?: LensApiMatch[];
  visual_matches?: LensApiMatch[];
  error?: unknown;
}

/**
 * Calls the Google Lens engine once. Exact matches come back as encrypted
 * Google redirects unless `link=resolved` is set; resolving costs no extra
 * search (measured live: one search either way, about the same latency), so it
 * is always on. Visual matches are already direct links.
 *
 * Returns only for a billed call; the caller records that cost immediately,
 * even when no page matched.
 */
export async function callGoogleLens(
  imageUrl: string,
  searchType: LensSearchType
): Promise<GoogleLensResult> {
  const params = new URLSearchParams({
    engine: "google_lens",
    search_type: searchType,
    url: imageUrl,
    link: "resolved",
  });
  const { data, httpStatus, elapsedMs } = await requestSearchApi<LensApiResponse>(params, "Google Lens");
  return {
    matches: parseLensMatches(searchType === "exact_matches" ? data.exact_matches : data.visual_matches),
    searchType,
    httpStatus,
    elapsedMs,
  };
}

/** Result entries with an http(s) link, in Google's order. A link still on google.com (an unresolved redirect) is dropped. */
export function parseLensMatches(items: LensApiMatch[] | undefined): LensMatch[] {
  if (!Array.isArray(items)) return [];
  const matches: LensMatch[] = [];
  for (const item of items) {
    const link = typeof item?.link === "string" ? item.link.trim() : "";
    if (!/^https?:\/\//i.test(link) || isGoogleRedirect(link)) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const source = typeof item.source === "string" ? item.source.trim() : "";
    matches.push({ link, title, ...(source ? { source } : {}) });
  }
  return matches;
}

function isGoogleRedirect(link: string): boolean {
  try {
    const url = new URL(link);
    return /(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname.startsWith("/goto");
  } catch {
    return true;
  }
}
