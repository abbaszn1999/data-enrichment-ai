import type { GalleryGoogleSettings } from "@/lib/gallery/types";
import {
  filterSerperCandidates,
  type SerperImageCandidate,
} from "@/lib/gallery/agent/filters";
import { galleryError, galleryLog, galleryWarn } from "@/lib/gallery/log";
import { requireSerpApiKey } from "@/lib/gallery/providers/serpapi-key";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const REQUEST_TIMEOUT_MS = 20_000;

type SerpApiImageResult = {
  original?: string;
  thumbnail?: string;
  link?: string;
  title?: string;
  source?: string;
  original_width?: number;
  original_height?: number;
};

function tbsForTimeRange(timeRange: string): string | undefined {
  if (/^qdr:[dwmy]$/.test(timeRange)) return timeRange;
  switch (timeRange) {
    case "d":
    case "day":
      return "qdr:d";
    case "w":
    case "week":
      return "qdr:w";
    case "m":
    case "month":
      return "qdr:m";
    case "y":
    case "year":
      return "qdr:y";
    default:
      return undefined;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Google Images via SerpApi (engine=google_images).
 * Settings at API: q, gl, hl, tbs (time), nfpr (when autocorrect off).
 * Client filters: source / marketplace / resolution / aspect / duplicates.
 * Candidate pool size caps how many we keep after filters (API returns ~100/page).
 */
export async function searchSerpApiImages(
  query: string,
  settings: GalleryGoogleSettings,
  officialDomainHints: string[] = []
): Promise<{ candidates: SerperImageCandidate[]; searchCount: number }> {
  if (!query.trim()) {
    return { candidates: [], searchCount: 0 };
  }

  const apiKey = requireSerpApiKey();
  const cap = Math.min(Math.max(settings.candidates || 25, 1), 100);
  const params = new URLSearchParams({
    engine: "google_images",
    q: query.trim(),
    api_key: apiKey,
    output: "json",
  });
  if (settings.country && settings.country !== "auto") {
    params.set("gl", settings.country);
  }
  if (settings.language && settings.language !== "auto") {
    params.set("hl", settings.language);
  }
  const tbs = tbsForTimeRange(settings.timeRange || "");
  if (tbs) params.set("tbs", tbs);
  // nfpr=1 disables Google auto-correction of the query.
  if (settings.autocorrect === false) {
    params.set("nfpr", "1");
  }

  galleryLog("serpapi:images:request", "Google Images via SerpApi", {
    q: query.trim().slice(0, 120),
    gl: settings.country,
    hl: settings.language,
    tbs: tbs || null,
    nfpr: settings.autocorrect === false ? "1" : null,
    candidateCap: cap,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${SERPAPI_BASE}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      galleryWarn("serpapi:images:response", `HTTP ${res.status}`, {
        body: text.slice(0, 400),
      });
      throw new Error(
        `SerpApi Images failed (${res.status}): ${text.slice(0, 200)}`
      );
    }

    let data: {
      error?: string;
      images_results?: SerpApiImageResult[];
    };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new Error("SerpApi Images returned non-JSON body");
    }
    if (data.error) {
      throw new Error(String(data.error));
    }

    const raw = Array.isArray(data.images_results) ? data.images_results : [];
    const mapped: SerperImageCandidate[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const imageUrl = (item.original || item.thumbnail || "").trim();
      if (!imageUrl || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      const pageUrl = item.link || "";
      mapped.push({
        imageUrl,
        pageUrl,
        title: item.title || "Product image",
        width: item.original_width || 0,
        height: item.original_height || 0,
        sourceDomain:
          hostnameOf(pageUrl) ||
          (item.source || "").toLowerCase() ||
          hostnameOf(imageUrl),
      });
    }

    const filtered = filterSerperCandidates(
      mapped,
      settings,
      officialDomainHints
    ).slice(0, cap);

    galleryLog("serpapi:images:response", "SerpApi Images candidates", {
      rawCount: mapped.length,
      filteredCount: filtered.length,
      top: filtered.slice(0, 5).map((c) => ({
        title: c.title,
        domain: c.sourceDomain,
        w: c.width,
        h: c.height,
        url: c.imageUrl.slice(0, 120),
      })),
    });

    return { candidates: filtered, searchCount: 1 };
  } catch (err) {
    galleryError("serpapi:images", "SerpApi Images request failed", err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectSerpApiImageCandidates(
  queries: string[],
  settings: GalleryGoogleSettings,
  officialDomainHints: string[] = []
): Promise<{ candidates: SerperImageCandidate[]; searchCount: number }> {
  const uniqueQueries = [
    ...new Set(queries.map((query) => query.trim()).filter(Boolean)),
  ];
  if (uniqueQueries.length === 0) {
    return { candidates: [], searchCount: 0 };
  }

  const results = await Promise.allSettled(
    uniqueQueries.map((query) =>
      searchSerpApiImages(query, settings, officialDomainHints)
    )
  );
  const perQuery = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value.candidates] : []
  );
  if (perQuery.length === 0) {
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    throw failed?.reason ?? new Error("All SerpApi image searches failed");
  }

  const seen = new Set<string>();
  const all: SerperImageCandidate[] = [];
  const maxLength = Math.max(0, ...perQuery.map((items) => items.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const items of perQuery) {
      const candidate = items[index];
      if (!candidate || seen.has(candidate.imageUrl)) continue;
      seen.add(candidate.imageUrl);
      all.push(candidate);
    }
  }

  const searchCount = results.reduce(
    (sum, result) =>
      sum + (result.status === "fulfilled" ? result.value.searchCount : 0),
    0
  );

  galleryLog("serpapi:images:merged", "Merged SerpApi Images candidates", {
    queries: uniqueQueries,
    searchCount,
    candidateCount: all.length,
  });

  return { candidates: all, searchCount };
}
