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
      /\/(images?|img|imgs|media|medias|cdn|static|assets|product-?images?|photos?|pictures?|uploads?|files|content\/dam|getimage)(\/|$)/i.test(
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
 * A link that is plainly a web page, not a picture: no path (a home page) or a
 * path that ends in a page extension. This is the only thing worth refusing
 * before the load check, because a shop's image address can look like anything
 * (`/medias/?context=...`, `/getImage?id=12`); whether it really is an image is
 * decided by loading it, never by guessing from the text of the link.
 */
export function looksLikeWebPageUrl(url: string): boolean {
  try {
    const path = new URL(url.trim()).pathname.toLowerCase();
    return path === "" || path === "/" || /\.(html?|php|aspx?|jsp|cfm)$/i.test(path);
  } catch {
    return true;
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
      // The tool typed this as an image. Do not guess from the path
      // (`/medias/?context=…` is a real picture on SAP shops). Refuse only a
      // link that is plainly a web page.
      if (!candidate || looksLikeWebPageUrl(candidate)) continue;
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
 * Never accept source_website_url / HTML pages. Pads up to limit from the tool
 * pool unless `pad` is false.
 */
export function pickImagesFromSelection(
  selected: unknown,
  toolImages: ImageUrl[],
  limit: number,
  options: { pad?: boolean } = {}
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
  if (options.pad !== false && out.length < limit) {
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

/**
 * Pages the model used in this response: `open_page` / `find_in_page`, and
 * `url_citation` annotations (the pages it named in the answer). Search-result
 * lists are not included — those were not opened.
 */
export function collectOpenedPages(response: OpenAiResponse): string[] {
  const pages: string[] = [];
  const add = (raw: string | undefined) => {
    const url = String(raw ?? "").trim();
    if (/^https?:\/\//i.test(url)) pages.push(url);
  };
  for (const output of response.output ?? []) {
    if (output.type === "web_search_call") {
      const action = output.action;
      if (action?.type === "open_page" || action?.type === "find_in_page") add(action.url);
    }
    for (const content of output.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type && annotation.type !== "url_citation") continue;
        add(annotation.url);
      }
    }
  }
  return pages;
}

/** Page navigation inside a search run; OpenAI does not bill these as tool calls. */
const UNBILLED_WEB_SEARCH_ACTIONS = new Set(["open_page", "find_in_page"]);

/**
 * Billable web-search tool calls in a response: `search` actions only. Items
 * without an action are counted so older payload shapes are never under-billed.
 */
export function countWebSearchCalls(response: OpenAiResponse): number {
  return (response.output ?? []).filter(
    (item: OpenAiResponseItem) =>
      item.type === "web_search_call" &&
      !UNBILLED_WEB_SEARCH_ACTIONS.has(item.action?.type ?? "")
  ).length;
}
