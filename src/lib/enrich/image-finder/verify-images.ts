import { mapLimit } from "@/lib/async/map-limit";
import type { ImageUrl } from "@/types";

const VERIFY_TIMEOUT_MS = 6_000;
const VERIFY_CONCURRENCY = 6;
const RETRY_DELAY_MS = 600;

/**
 * Many shops and CDNs answer a bare server request with 403/429 or an empty
 * body while serving the same image to a browser. The check therefore looks
 * like a browser that arrived from the product page.
 */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

export type ImageCheck = "ok" | "unverified" | "rejected";

type Probe = "image" | "not_image" | "gone" | "blocked";

function requestHeaders(pageUrl: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_USER_AGENT,
    Accept: IMAGE_ACCEPT,
    ...extra,
  };
  if (pageUrl && /^https?:\/\//i.test(pageUrl)) headers.Referer = pageUrl;
  return headers;
}

/** JPEG, PNG, GIF, WebP and AVIF signatures, for servers that send the wrong (or no) content-type. */
export function looksLikeImageBytes(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(bytes.slice(from, to)));
  if (bytes.length >= 4 && ascii(0, 4) === "GIF8") return true;
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return true;
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return true;
  return false;
}

/** The first bytes of a body, without downloading the rest. */
async function readHead(response: Response, maxBytes = 32): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  try {
    const { value } = await reader.read();
    return value ? value.slice(0, maxBytes) : new Uint8Array();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function contentTypeOf(response: Response): string {
  return (response.headers.get("content-type") || "").toLowerCase();
}

/** Content-types that say "some file", so the bytes decide whether it is an image. */
function isVagueContentType(contentType: string): boolean {
  return !contentType || contentType.startsWith("application/octet-stream") || contentType.startsWith("binary/");
}

/** 404/410: the file is really gone. Anything else that is not a success may be our server being refused. */
function isGone(status: number): boolean {
  return status === 404 || status === 410;
}

async function classify(response: Response): Promise<Probe> {
  if (isGone(response.status)) return "gone";
  if (!response.ok) return "blocked";
  const contentType = contentTypeOf(response);
  if (contentType.startsWith("image/")) return "image";
  if (!isVagueContentType(contentType)) return "not_image";
  return looksLikeImageBytes(await readHead(response)) ? "image" : "not_image";
}

async function probeOnce(url: string, pageUrl: string | undefined, timeoutMs: number): Promise<Probe> {
  try {
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: requestHeaders(pageUrl),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (head.ok && contentTypeOf(head).startsWith("image/")) return "image";
    if (isGone(head.status)) return "gone";
    // A definite non-image answer to HEAD ends it; anything else (blocked,
    // vague type, HEAD unsupported) is settled by a real, bounded GET.
    if (head.ok && !isVagueContentType(contentTypeOf(head))) return "not_image";
  } catch {
    // HEAD unsupported/blocked/timed out — fall through to a bounded GET.
  }

  try {
    const get = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: requestHeaders(pageUrl, { Range: "bytes=0-2048" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await classify(get);
  } catch {
    return "blocked";
  }
}

/**
 * Does this image link load, and is it really an image? "unverified" means
 * our server could not tell (refused with 403/429, timed out, unreachable)
 * after one retry — not that the image is broken. 404/410 and non-image
 * files are "rejected" straight away.
 */
export async function checkImageUrl(
  url: string,
  options: { pageUrl?: string; timeoutMs?: number; retryDelayMs?: number } = {}
): Promise<ImageCheck> {
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS;
  let result = await probeOnce(url, options.pageUrl, timeoutMs);
  if (result === "blocked") {
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? RETRY_DELAY_MS));
    result = await probeOnce(url, options.pageUrl, timeoutMs);
  }
  if (result === "image") return "ok";
  if (result === "blocked") return "unverified";
  return "rejected";
}

/** Strict form: true only when the image was actually confirmed to load. */
export async function verifyImageUrl(
  url: string,
  timeoutMs: number = VERIFY_TIMEOUT_MS,
  pageUrl?: string
): Promise<boolean> {
  return (await checkImageUrl(url, { timeoutMs, pageUrl })) === "ok";
}

/** Verifies every URL in parallel; returns only the ones confirmed to load. */
export async function verifyImageUrls(
  urls: string[],
  concurrency: number = VERIFY_CONCURRENCY
): Promise<Set<string>> {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  const results = await mapLimit(unique, concurrency, async (url) => ({
    url,
    ok: await verifyImageUrl(url),
  }));
  return new Set(results.filter((r) => r.ok).map((r) => r.url.toLowerCase()));
}

/**
 * `%XX`-encoded characters can break an otherwise-real image URL (a CDN that
 * serves `filters%3Aformat%28avif%29` as a path segment while the plain
 * `filters:format(avif)` form of the same URL loads); the decoded form is
 * tried too before a candidate is given up on.
 */
export function decodedVariant(url: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(url)) return null;
  try {
    const decoded = decodeURIComponent(url);
    return decoded !== url ? decoded : null;
  } catch {
    return null;
  }
}

export interface LoadableImages {
  /** Candidates that loaded (or, when unverified, were kept because their page was opened), best first. */
  images: ImageUrl[];
  /** How many kept images could not be load-checked from our server. */
  unverified: number;
}

/** Store-owner-facing note for images kept without a successful load check. */
export function unverifiedImagesNote(count: number): string {
  if (count <= 0) return "";
  return count === 1
    ? "1 image could not be load-checked from our server (it was shown on the product page)."
    : `${count} images could not be load-checked from our server (they were shown on the product page).`;
}

/**
 * The one load check every tier uses. Each candidate is checked the way a
 * browser coming from its product page would (Referer), under its decoded
 * link too when that differs. Confirmed images are kept; an image our server
 * merely could not check (refused or timed out twice) is also kept, because
 * every candidate here comes from a page the tier itself opened, and is
 * counted so the row can say so. A definite 404/410 or a non-image is dropped.
 */
export async function keepLoadableImages(candidates: ImageUrl[], limit: number): Promise<LoadableImages> {
  const checked = await mapLimit(candidates, VERIFY_CONCURRENCY, async (candidate) => {
    const variants = [candidate.imageUrl, decodedVariant(candidate.imageUrl)].filter(
      (value): value is string => Boolean(value)
    );
    let unverified = false;
    for (const variant of variants) {
      const check = await checkImageUrl(variant, { pageUrl: candidate.pageUrl });
      if (check === "ok") return { image: { ...candidate, imageUrl: variant }, unverified: false };
      if (check === "unverified") unverified = true;
    }
    return unverified ? { image: candidate, unverified: true } : null;
  });

  const kept = checked.filter((entry): entry is { image: ImageUrl; unverified: boolean } => entry !== null);
  const images = kept.slice(0, limit);
  return { images: images.map((entry) => entry.image), unverified: images.filter((entry) => entry.unverified).length };
}
