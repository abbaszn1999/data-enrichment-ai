import type { ImageUrl, SourceUrl } from "@/types";

/** Host without `www.`; empty when the value is not a URL. */
function siteName(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/** Same page regardless of protocol, `www.`, trailing slash or fragment. */
function pageIdentity(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path}${url.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * The Image sources column: the distinct product pages the kept images came
 * from, in the order of the images (best first), each titled with its site
 * name. Only real http(s) pages are listed, so every entry is a working link.
 * Empty when there are no images — the cell then shows nothing.
 */
export function buildImageSourceUrls(images: ImageUrl[]): SourceUrl[] {
  const seen = new Set<string>();
  const sources: SourceUrl[] = [];
  for (const image of images) {
    const pageUrl = String(image.pageUrl ?? "").trim();
    if (!/^https?:\/\//i.test(pageUrl)) continue;
    const site = siteName(pageUrl);
    if (!site) continue;
    const identity = pageIdentity(pageUrl);
    if (seen.has(identity)) continue;
    seen.add(identity);
    sources.push({ title: site, uri: pageUrl });
  }
  return sources;
}
