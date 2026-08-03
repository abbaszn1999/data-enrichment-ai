import type { GalleryGoogleSettings } from "@/lib/gallery/types";
import {
  filterSerperCandidates,
  type SerperImageCandidate,
} from "@/lib/gallery/agent/filters";
import { galleryError, galleryLog, galleryWarn } from "@/lib/gallery/log";
import { requireSerpApiKey } from "@/lib/gallery/providers/serpapi-key";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const REQUEST_TIMEOUT_MS = 20_000;

type SerpApiVisualMatch = {
  position?: number;
  title?: string;
  link?: string;
  source?: string;
  thumbnail?: string;
  image?: string;
  image_width?: number;
  image_height?: number;
  thumbnail_width?: number;
  thumbnail_height?: number;
  exact_matches?: boolean;
  price?: { value?: string; extracted_value?: number; currency?: string };
  in_stock?: boolean;
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Prefer catalog-like images before Gemini ranking:
 * near-square, has product price signal, larger of the two dimensions.
 */
function preferCatalogCandidates(
  candidates: SerperImageCandidate[],
  limit: number
): SerperImageCandidate[] {
  const scored = candidates.map((candidate, index) => {
    const w = candidate.width || 0;
    const h = candidate.height || 0;
    let score = 0;
    if (w > 0 && h > 0) {
      const ratio = w / h;
      if (ratio >= 0.75 && ratio <= 1.35) score += 4;
      else if (ratio >= 0.55 && ratio <= 1.8) score += 2;
      if (Math.min(w, h) >= 300) score += 2;
      if (Math.min(w, h) >= 500) score += 1;
      // Very tall/narrow thumbs often come from page UI strips.
      if (ratio < 0.45 || ratio > 2.2) score -= 3;
    }
    const title = candidate.title.toLowerCase();
    if (
      /add to cart|buy now|\$\d|£\d|€\d|magento|woocommerce|plugin|extension/.test(
        title
      )
    ) {
      score -= 4;
    }
    return { candidate, index, score };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, Math.max(1, limit)).map((row) => row.candidate);
}

/**
 * Google Lens Visual Matches only (SerpApi).
 * Settings applied at API: country, hl, optional q.
 * Settings applied after fetch: candidates cap, source/marketplace/resolution/aspect/duplicates filters.
 * Not supported by Lens API: autocorrect, timeRange (tbs).
 */
export async function searchSerpApiVisualMatches(
  imageUrl: string,
  settings: GalleryGoogleSettings,
  options: {
    q?: string;
    officialDomainHints?: string[];
  } = {}
): Promise<{
  candidates: SerperImageCandidate[];
  searchCount: number;
  relatedQueries: string[];
}> {
  const url = imageUrl.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("Google Lens requires a public http(s) image URL");
  }

  const apiKey = requireSerpApiKey();
  const params = new URLSearchParams({
    engine: "google_lens",
    type: "visual_matches",
    url,
    api_key: apiKey,
    output: "json",
  });
  if (settings.country && settings.country !== "auto") {
    params.set("country", settings.country);
  }
  if (settings.language && settings.language !== "auto") {
    params.set("hl", settings.language);
  }
  const refine = options.q?.trim();
  if (refine) {
    params.set("q", refine.slice(0, 120));
  }

  galleryLog("serpapi:lens:request", "Google Lens visual_matches", {
    url: url.slice(0, 160),
    type: "visual_matches",
    country: settings.country,
    hl: settings.language,
    q: refine?.slice(0, 120) || null,
    candidateCap: settings.candidates,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(`${SERPAPI_BASE}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      galleryWarn("serpapi:lens:response", `HTTP ${res.status}`, {
        body: text.slice(0, 400),
      });
      throw new Error(`SerpApi Lens failed (${res.status}): ${text.slice(0, 200)}`);
    }

    let data: {
      error?: string;
      visual_matches?: SerpApiVisualMatch[];
      related_content?: Array<{ query?: string }>;
      search_metadata?: { status?: string };
    };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new Error("SerpApi Lens returned non-JSON body");
    }
    if (data.error) {
      throw new Error(String(data.error));
    }

    const matches = Array.isArray(data.visual_matches) ? data.visual_matches : [];
    const mapped: SerperImageCandidate[] = [];
    const seen = new Set<string>();
    for (const item of matches) {
      // Prefer full `image` over thumbnail — thumbnails can be page crops.
      const imageUrlValue = (item.image || item.thumbnail || "").trim();
      if (!imageUrlValue || seen.has(imageUrlValue)) continue;
      seen.add(imageUrlValue);
      const pageUrl = item.link || "";
      mapped.push({
        imageUrl: imageUrlValue,
        pageUrl,
        title: item.title || "Product image",
        width: item.image_width || item.thumbnail_width || 0,
        height: item.image_height || item.thumbnail_height || 0,
        sourceDomain:
          hostnameOf(pageUrl) ||
          (item.source || "").toLowerCase() ||
          hostnameOf(imageUrlValue),
      });
    }

    const filtered = filterSerperCandidates(
      mapped,
      settings,
      options.officialDomainHints || []
    );
    const cap = Math.min(Math.max(settings.candidates || 25, 1), 100);
    const ranked = preferCatalogCandidates(filtered, cap);

    const relatedQueries = (data.related_content || [])
      .map((item) => String(item.query || "").trim())
      .filter(Boolean)
      .slice(0, 5);

    galleryLog("serpapi:lens:response", "visual_matches candidates", {
      ms: Date.now() - started,
      status: data.search_metadata?.status,
      rawCount: mapped.length,
      filteredCount: filtered.length,
      cappedCount: ranked.length,
      candidateCap: cap,
      relatedQueries,
      top: ranked.slice(0, 5).map((c) => ({
        title: c.title,
        domain: c.sourceDomain,
        w: c.width,
        h: c.height,
        url: c.imageUrl.slice(0, 120),
      })),
    });

    return {
      candidates: ranked,
      searchCount: 1,
      relatedQueries,
    };
  } catch (err) {
    galleryError("serpapi:lens", "visual_matches request failed", err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
