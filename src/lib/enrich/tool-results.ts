/**
 * Extraction of validated artefacts from an OpenAI Responses payload:
 * image results, source citations, and search-call counts.
 *
 * Kept separate from parse.ts so column specs can use these helpers without
 * importing the parse layer that consumes the spec registry.
 */
import type { ImageUrl, SourceUrl } from "@/types";
import type { OpenAiResponse, OpenAiResponseItem } from "./types";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True for likely direct image asset URLs (not HTML catalogue pages). */
export function looksLikeDirectImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.toLowerCase();
    if (/\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|$)/i.test(path)) return true;
    // CDN / search image endpoints often omit extensions
    if (
      /\/(images?|img|media|cdn|static|assets|product-images?)(\/|$)/i.test(
        path
      ) &&
      !path.endsWith(".html") &&
      !path.endsWith(".htm") &&
      !path.endsWith(".php") &&
      !path.endsWith(".aspx")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Collect image results from web_search_call items.
 * Uses image_url only (never source_website_url as the image).
 */
export function collectToolImages(response: OpenAiResponse): ImageUrl[] {
  const seen = new Set<string>();
  const images: ImageUrl[] = [];

  for (const output of response.output ?? []) {
    if (output.type !== "web_search_call") continue;
    const results = output.results ?? output.action?.results ?? [];
    for (const result of results) {
      if (result.type !== "image_result") continue;
      const canonical = String(result.image_url || "").trim();
      const thumb = String(result.thumbnail_url || "").trim();
      // Prefer canonical image_url; thumbnail only as last resort
      const candidate = /^https:\/\//i.test(canonical)
        ? canonical
        : /^https:\/\//i.test(thumb)
          ? thumb
          : "";
      // Reject HTML/page URLs even if they appear in image_url
      if (!candidate || !looksLikeDirectImageUrl(candidate)) continue;
      const imageUrl = candidate;
      const key = imageUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const pageUrl = String(result.source_website_url || "").trim();
      images.push({
        imageUrl,
        pageUrl: /^https?:\/\//i.test(pageUrl) ? pageUrl : imageUrl,
        title: String(result.caption || "Product image").slice(0, 300),
      });
    }
  }
  return images;
}

/** Collect sources from annotations + web_search_call.action.sources. */
export function collectToolSources(response: OpenAiResponse): SourceUrl[] {
  const seen = new Set<string>();
  const sources: SourceUrl[] = [];

  const push = (title: string, uri: string) => {
    const url = String(uri || "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({
      title: (title || hostnameOf(url) || "Source").slice(0, 300),
      uri: url,
    });
  };

  for (const output of response.output ?? []) {
    if (output.type === "web_search_call") {
      for (const src of output.action?.sources ?? []) {
        push(String(src.title || ""), String(src.url || ""));
      }
    }
    for (const content of output.content ?? []) {
      for (const ann of content.annotations ?? []) {
        if (ann.type && ann.type !== "url_citation") continue;
        push(String(ann.title || ""), String(ann.url || ""));
      }
    }
  }

  return sources;
}

/**
 * Keep only model-selected URLs that exactly match tool image_url values.
 * Never accept source_website_url / HTML pages. Pad up to limit from tool pool.
 */
export function pickImagesFromSelection(
  selected: unknown,
  toolImages: ImageUrl[],
  limit: number
): ImageUrl[] {
  if (limit <= 0) return [];
  const byUrl = new Map(
    toolImages.map((img) => [img.imageUrl.toLowerCase(), img])
  );
  const out: ImageUrl[] = [];
  const seen = new Set<string>();

  const candidates = Array.isArray(selected)
    ? selected.map((u) => String(u || "").trim())
    : [];

  for (const url of candidates) {
    if (!/^https:\/\//i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    // Exact image_url match only — do NOT match pageUrl (prevents catalogue pages)
    const matched = byUrl.get(key);
    if (!matched) continue;
    seen.add(key);
    out.push(matched);
    if (out.length >= limit) break;
  }

  // Pad with remaining tool images until limit
  if (out.length < limit) {
    for (const img of toolImages) {
      const key = img.imageUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(img);
      if (out.length >= limit) break;
    }
  }

  return out;
}

export function countWebSearchCalls(response: OpenAiResponse): number {
  return (response.output ?? []).filter(
    (item: OpenAiResponseItem) => item.type === "web_search_call"
  ).length;
}
