import type { GalleryGoogleSettings } from "@/lib/gallery/types";
import {
  filterSerperCandidates,
  type SerperImageCandidate,
} from "@/lib/gallery/agent/filters";
import { galleryError, galleryLog, galleryWarn } from "@/lib/gallery/log";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_DOWNLOAD_ATTEMPTS = 3;

/** Content-Type is a singleton; Fetch joins duplicate headers with ", ". */
export function normalizeDeclaredContentType(raw: string | null): string {
  if (!raw) return "";
  return raw.split(",")[0].split(";")[0].trim().toLowerCase();
}

function isSoftAllowedContentType(declaredType: string): boolean {
  return (
    !declaredType ||
    declaredType === "application/octet-stream" ||
    declaredType === "binary/octet-stream" ||
    /^image\/(jpeg|jpg|png|webp|gif|avif)$/.test(declaredType)
  );
}

function isRetryableDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket") ||
    msg.includes("tls") ||
    msg.includes("undici")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SerperRawImage = {
  imageUrl?: string;
  link?: string;
  title?: string;
  imageWidth?: number;
  imageHeight?: number;
  source?: string;
  domain?: string;
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

export async function searchSerperImages(
  query: string,
  settings: GalleryGoogleSettings,
  officialDomainHints: string[] = []
): Promise<{ candidates: SerperImageCandidate[]; queryCount: number }> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY is not configured");
  }
  if (!query.trim()) {
    return { candidates: [], queryCount: 0 };
  }

  const num = Math.min(Math.max(settings.candidates || 25, 1), 100);
  const body: Record<string, unknown> = {
    q: query,
    num,
    autocorrect: settings.autocorrect !== false,
  };
  if (settings.country && settings.country !== "auto") {
    body.gl = settings.country;
  }
  if (settings.language && settings.language !== "auto") {
    body.hl = settings.language;
  }
  const tbs = tbsForTimeRange(settings.timeRange || "");
  if (tbs) body.tbs = tbs;

  galleryLog("serper:images:request", "Searching Google Images via Serper", body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      galleryWarn("serper:images:response", `HTTP ${res.status}`, {
        body: text.slice(0, 400),
      });
      throw new Error(`Serper images failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as { images?: SerperRawImage[] };
    const raw = Array.isArray(data.images) ? data.images : [];
    const mapped = mapRawImages(raw);
    const filtered = filterSerperCandidates(
      mapped,
      settings,
      officialDomainHints
    );
    galleryLog("serper:images:response", "Serper Images candidates", {
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

    return {
      candidates: filtered,
      queryCount: 1,
    };
  } catch (err) {
    galleryError("serper:images", "Serper Images request failed", err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function mapRawImages(raw: SerperRawImage[]): SerperImageCandidate[] {
  return raw
    .filter((img) => !!img.imageUrl)
    .map((img) => {
      let sourceDomain = (img.domain || img.source || "").toLowerCase();
      if (!sourceDomain && img.link) {
        sourceDomain = hostnameOf(img.link);
      }
      if (!sourceDomain && img.imageUrl) {
        sourceDomain = hostnameOf(img.imageUrl);
      }
      return {
        imageUrl: img.imageUrl!,
        pageUrl: img.link || "",
        title: img.title || "Product image",
        width: img.imageWidth || 0,
        height: img.imageHeight || 0,
        sourceDomain,
      };
    });
}

/**
 * Reverse / visual image search via Serper Google Lens.
 * POST https://google.serper.dev/lens  { url, gl?, hl? }
 */
export async function searchSerperLens(
  imageUrl: string,
  settings: GalleryGoogleSettings,
  officialDomainHints: string[] = []
): Promise<{
  candidates: SerperImageCandidate[];
  queryCount: number;
  relatedQueries: string[];
}> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY is not configured");
  }
  const url = imageUrl.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("Serper Lens requires a public http(s) image URL");
  }

  const body: Record<string, unknown> = { url };
  if (settings.country && settings.country !== "auto") {
    body.gl = settings.country;
  }
  if (settings.language && settings.language !== "auto") {
    body.hl = settings.language;
  }

  galleryLog("serper:lens:request", "Searching Google Lens via Serper", {
    url: url.slice(0, 160),
    gl: body.gl,
    hl: body.hl,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch("https://google.serper.dev/lens", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      galleryWarn("serper:lens:response", `HTTP ${res.status}`, {
        body: text.slice(0, 400),
      });
      throw new Error(`Serper Lens failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const buckets: SerperRawImage[] = [];

    const pushBucket = (value: unknown) => {
      if (!Array.isArray(value)) return;
      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const imageUrlValue =
          (typeof row.imageUrl === "string" && row.imageUrl) ||
          (typeof row.image === "string" && row.image) ||
          (typeof row.thumbnailUrl === "string" && row.thumbnailUrl) ||
          (typeof row.thumbnail === "string" && row.thumbnail) ||
          "";
        if (!imageUrlValue) continue;
        buckets.push({
          imageUrl: imageUrlValue,
          link:
            (typeof row.link === "string" && row.link) ||
            (typeof row.source === "string" && row.source) ||
            "",
          title:
            (typeof row.title === "string" && row.title) ||
            (typeof row.source === "string" && row.source) ||
            "Product image",
          imageWidth:
            typeof row.imageWidth === "number"
              ? row.imageWidth
              : typeof row.width === "number"
                ? row.width
                : 0,
          imageHeight:
            typeof row.imageHeight === "number"
              ? row.imageHeight
              : typeof row.height === "number"
                ? row.height
                : 0,
          source:
            (typeof row.source === "string" && row.source) ||
            (typeof row.domain === "string" && row.domain) ||
            undefined,
          domain:
            (typeof row.domain === "string" && row.domain) || undefined,
        });
      }
    };

    pushBucket(data.images);
    pushBucket(data.visualMatches);
    pushBucket(data.organic);

    const relatedQueries = Array.isArray(data.relatedSearches)
      ? data.relatedSearches
          .map((item) => {
            if (typeof item === "string") return item.trim();
            if (item && typeof item === "object") {
              const query = (item as { query?: unknown }).query;
              return typeof query === "string" ? query.trim() : "";
            }
            return "";
          })
          .filter(Boolean)
          .slice(0, 5)
      : [];

    const mapped = mapRawImages(buckets);
    const seen = new Set<string>();
    const deduped = mapped.filter((candidate) => {
      if (seen.has(candidate.imageUrl)) return false;
      seen.add(candidate.imageUrl);
      return true;
    });
    const filtered = filterSerperCandidates(
      deduped,
      settings,
      officialDomainHints
    );

    galleryLog("serper:lens:response", "Serper Lens candidates", {
      sourceImage: url.slice(0, 160),
      rawCount: deduped.length,
      filteredCount: filtered.length,
      relatedQueries,
      responseKeys: Object.keys(data).slice(0, 20),
      top: filtered.slice(0, 5).map((c) => ({
        title: c.title,
        domain: c.sourceDomain,
        url: c.imageUrl.slice(0, 120),
      })),
    });

    return {
      candidates: filtered,
      queryCount: 1,
      relatedQueries,
    };
  } catch (err) {
    galleryError("serper:lens", "Serper Lens request failed", err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectSerperImageCandidates(
  queries: string[],
  settings: GalleryGoogleSettings,
  officialDomainHints: string[] = []
): Promise<{ candidates: SerperImageCandidate[]; queryCount: number }> {
  const uniqueQueries = [
    ...new Set(queries.map((query) => query.trim()).filter(Boolean)),
  ];
  if (uniqueQueries.length === 0) {
    return { candidates: [], queryCount: 0 };
  }

  const results = await Promise.allSettled(
    uniqueQueries.map((query) =>
      searchSerperImages(query, settings, officialDomainHints)
    )
  );
  const perQuery = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value.candidates] : []
  );
  if (perQuery.length === 0) {
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    throw failed?.reason ?? new Error("All Serper image searches failed");
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

  const queryCount = results.reduce(
    (sum, result) =>
      sum + (result.status === "fulfilled" ? result.value.queryCount : 0),
    0
  );

  galleryLog("serper:images:merged", "Merged Serper Images candidates", {
    queries: uniqueQueries,
    queryCount,
    candidateCount: all.length,
  });

  return { candidates: all, queryCount };
}

export async function downloadImageBytes(
  imageUrl: string,
  constraints?: Pick<GalleryGoogleSettings, "minResolution" | "aspectRatio">
): Promise<{ buffer: Buffer; contentType: string; ext: string } | null> {
  const isPrivateAddress = (address: string): boolean => {
    const value = address.toLowerCase();
    if (value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) {
      return true;
    }
    if (value.startsWith("::ffff:")) {
      return isPrivateAddress(value.slice("::ffff:".length));
    }
    const parts = value.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] >= 224
    );
  };

  const assertSafeUrl = async (value: string): Promise<URL> => {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported image URL protocol");
    }
    if (
      url.username ||
      url.password ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".local")
    ) {
      throw new Error("Unsafe image URL");
    }
    const addresses = isIP(url.hostname)
      ? [{ address: url.hostname }]
      : await lookup(url.hostname, { all: true });
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => isPrivateAddress(address))
    ) {
      throw new Error("Image URL resolves to a private address");
    }
    return url;
  };

  const detectImageType = (
    buffer: Buffer
  ): { contentType: string; ext: string } | null => {
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return { contentType: "image/jpeg", ext: "jpg" };
    }
    if (
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return { contentType: "image/png", ext: "png" };
    }
    if (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return { contentType: "image/webp", ext: "webp" };
    }
    if (buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) {
      return { contentType: "image/gif", ext: "gif" };
    }
    const boxType = buffer.subarray(4, 12).toString("ascii");
    if (/^ftyp(avif|avis|heic|heix|mif1)/.test(boxType)) {
      return { contentType: "image/avif", ext: "avif" };
    }
    return null;
  };

  const attemptDownload = async (): Promise<{
    buffer: Buffer;
    contentType: string;
    ext: string;
  } | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      let currentUrl = (await assertSafeUrl(imageUrl)).toString();
      let res: Response | null = null;
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        res = await fetch(currentUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: new URL(currentUrl).origin + "/",
          },
          redirect: "manual",
        });
        if (![301, 302, 303, 307, 308].includes(res.status)) break;
        const location = res.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) {
          galleryWarn("download", "Image redirect chain exhausted", {
            reasonCode: "redirect_exhausted",
            imageUrl: imageUrl.slice(0, 200),
            status: res.status,
          });
          return null;
        }
        currentUrl = (
          await assertSafeUrl(new URL(location, currentUrl).toString())
        ).toString();
      }
      if (!res?.ok || !res.body) {
        galleryWarn("download", "Image HTTP response not OK", {
          reasonCode: "http_not_ok",
          imageUrl: imageUrl.slice(0, 200),
          status: res?.status ?? null,
        });
        return null;
      }

      const declaredLength = Number(res.headers.get("content-length") || 0);
      if (declaredLength > MAX_IMAGE_BYTES) {
        galleryWarn("download", "Image content-length too large", {
          reasonCode: "content_length_exceeded",
          imageUrl: imageUrl.slice(0, 200),
          declaredLength,
        });
        return null;
      }

      const rawDeclaredType = res.headers.get("content-type");
      const declaredType = normalizeDeclaredContentType(rawDeclaredType);
      // CDNs often omit type, use octet-stream, or send duplicate Content-Type
      // headers (Fetch joins them as "image/png, image/png"). Never hard-reject
      // on header alone — magic bytes below are authoritative.
      if (!isSoftAllowedContentType(declaredType)) {
        galleryWarn("download", "Image content-type suspicious; trusting magic bytes", {
          reasonCode: "content_type_suspicious",
          imageUrl: imageUrl.slice(0, 200),
          declaredType,
          rawDeclaredType: rawDeclaredType?.slice(0, 120) ?? null,
        });
      }

      const reader = res.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel();
          galleryWarn("download", "Image body exceeded size limit", {
            reasonCode: "body_size_exceeded",
            imageUrl: imageUrl.slice(0, 200),
          });
          return null;
        }
        chunks.push(Buffer.from(value));
      }
      if (total === 0) {
        galleryWarn("download", "Image body empty", {
          reasonCode: "empty_body",
          imageUrl: imageUrl.slice(0, 200),
        });
        return null;
      }

      const buffer = Buffer.concat(chunks, total);
      const detected = detectImageType(buffer);
      if (!detected) {
        galleryWarn("download", "Body is not a recognized image", {
          reasonCode: "unrecognized_image",
          imageUrl: imageUrl.slice(0, 200),
          declaredType,
          bytes: total,
        });
        return null;
      }
      const dimensions = await sharp(buffer, {
        animated: false,
        limitInputPixels: 100_000_000,
      }).metadata();
      const width = dimensions.width || 0;
      const height = dimensions.height || 0;
      if (!width || !height || width * height > 100_000_000) {
        galleryWarn("download", "Image dimensions invalid", {
          reasonCode: "invalid_dimensions",
          imageUrl: imageUrl.slice(0, 200),
          width,
          height,
        });
        return null;
      }
      if (
        constraints?.minResolution &&
        (width < constraints.minResolution || height < constraints.minResolution)
      ) {
        galleryWarn("download", "Image below minResolution", {
          reasonCode: "below_min_resolution",
          imageUrl: imageUrl.slice(0, 200),
          width,
          height,
          minResolution: constraints.minResolution,
        });
        return null;
      }
      if (constraints?.aspectRatio && constraints.aspectRatio !== "any") {
        const ratio = width / height;
        const bucket =
          ratio >= 1.6 ? "landscape" : ratio <= 0.75 ? "portrait" : "square";
        if (bucket !== constraints.aspectRatio) {
          galleryWarn("download", "Image aspect ratio rejected", {
            reasonCode: "aspect_ratio_rejected",
            imageUrl: imageUrl.slice(0, 200),
            bucket,
            required: constraints.aspectRatio,
          });
          return null;
        }
      }
      return { buffer, ...detected };
    } finally {
      clearTimeout(timeout);
    }
  };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await attemptDownload();
    } catch (error) {
      lastError = error;
      if (
        !isRetryableDownloadError(error) ||
        attempt === MAX_DOWNLOAD_ATTEMPTS
      ) {
        break;
      }
      galleryWarn("download", "Image download retrying after network error", {
        reasonCode: "download_retry",
        imageUrl: imageUrl.slice(0, 200),
        attempt,
        maxAttempts: MAX_DOWNLOAD_ATTEMPTS,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(250 * attempt);
    }
  }

  galleryWarn("download", "Image download threw", {
    reasonCode: "download_error",
    imageUrl: imageUrl.slice(0, 200),
    error:
      lastError instanceof Error ? lastError.message : String(lastError ?? "unknown"),
  });
  return null;
}
