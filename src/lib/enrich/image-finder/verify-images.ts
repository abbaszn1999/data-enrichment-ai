import { mapLimit } from "@/lib/async/map-limit";

const VERIFY_TIMEOUT_MS = 6_000;
const VERIFY_CONCURRENCY = 6;

/**
 * Does this URL actually load, and is it actually an image? This is the one
 * check that replaces "must come from a specific tool field" — the model may
 * report any real link it saw (search result or a page it opened); we accept
 * it only once we've confirmed it for ourselves.
 */
export async function verifyImageUrl(
  url: string,
  timeoutMs: number = VERIFY_TIMEOUT_MS
): Promise<boolean> {
  const isImageResponse = (response: Response): boolean => {
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") || "";
    return contentType.toLowerCase().startsWith("image/");
  };

  try {
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (isImageResponse(head)) return true;
    // Some CDNs answer HEAD with 403/405 or omit content-type but serve the
    // real file on GET — only retry when HEAD itself didn't disprove it.
    if (head.status !== 403 && head.status !== 405 && head.status !== 501) {
      return false;
    }
  } catch {
    // HEAD unsupported/blocked/timed out — fall through to a bounded GET.
  }

  try {
    const get = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { Range: "bytes=0-2048" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return isImageResponse(get);
  } catch {
    return false;
  }
}

/** Verifies every URL in parallel; returns only the ones that are real, loadable images. */
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
