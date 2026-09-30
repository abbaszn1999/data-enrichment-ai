import { NextRequest, NextResponse } from "next/server";
import { isPublicHttpUrl } from "@/lib/net/public-host";

/** Largest image the proxy will relay. */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
/** A product image rarely changes; a week in the CDN keeps sheets fast and links alive. */
const CACHE_CONTROL = "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

function fail(error: string, status: number) {
  // Errors are cached briefly so a dead link does not hit the origin on every render.
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": status >= 500 ? "no-store" : "public, max-age=300" } }
  );
}

/** Fetches with manual redirects so every hop is checked against the private-host rules. */
async function fetchPublicImage(start: URL, signal: AbortSignal): Promise<Response | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!(await isPublicHttpUrl(current))) return null;
    const response = await fetch(current, {
      signal,
      redirect: "manual",
      headers: { ...BROWSER_HEADERS, Referer: `${current.origin}/` },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      try {
        current = new URL(location, current);
      } catch {
        return null;
      }
      continue;
    }
    return response;
  }
  return null;
}

async function readCapped(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) return null;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return fail("Missing url parameter", 400);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return fail("Invalid url", 400);
  }
  if (!(await isPublicHttpUrl(target))) return fail("This address cannot be proxied", 400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchPublicImage(target, controller.signal);
    if (!response) return fail("This address cannot be proxied", 400);
    if (!response.ok) return fail(`Upstream returned ${response.status}`, 502);

    // Only relay raster images. SVG can carry script and would run on our origin.
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/") || contentType.includes("svg")) {
      return fail("URL does not point to an image", 400);
    }

    const bytes = await readCapped(response);
    if (!bytes) return fail("Image is too large", 413);

    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[ImageProxy] Error:", err instanceof Error ? err.message : err);
    return fail("Failed to fetch image", 502);
  } finally {
    clearTimeout(timeout);
  }
}
