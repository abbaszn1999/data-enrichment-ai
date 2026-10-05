"use client";

import { useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";

/** Storage links are already ours and signed; everything else goes through the cached proxy. */
function needsProxy(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/\/storage\/v1\/object\//i.test(url);
}

export function proxiedImageSrc(url: string): string {
  return needsProxy(url) ? `/api/image-proxy?url=${encodeURIComponent(url)}` : url;
}

/** Ordered sources to try: proxy, original link, then the fallback link the same way. */
function buildSources(url: string, fallbackUrl?: string | null): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  for (const candidate of [url, fallbackUrl ?? ""]) {
    if (!candidate) continue;
    if (needsProxy(candidate)) add(proxiedImageSrc(candidate));
    add(candidate);
  }
  return out;
}

/**
 * A sheet image that keeps working when the store's link goes stale or blocks
 * hot-linking: it loads through our cached proxy first (a week in the CDN, so
 * re-opening a sheet is fast), then tries the original link, then the fallback
 * link, and if all fail shows an "Image unavailable" tile instead of a broken
 * image. The stored link is never changed, so exports still carry the original URL.
 */
export function SheetImage({
  url,
  fallbackUrl,
  alt,
  className,
  tileClassName,
  loadingClassName,
  linkOnFail = false,
}: {
  url: string;
  /** Another link for the same image, tried after the main one fails. */
  fallbackUrl?: string | null;
  alt: string;
  /** Classes for the loaded image. */
  className?: string;
  /** Classes for the "Image unavailable" tile; defaults to filling the same box as the image. */
  tileClassName?: string;
  /** Classes for a spinner tile shown until the image arrives (large previews of slow shops). */
  loadingClassName?: string;
  /** Show the original link under the tile (for large previews). */
  linkOnFail?: boolean;
}) {
  const key = `${url}|${fallbackUrl ?? ""}`;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [forKey, setForKey] = useState(key);
  if (forKey !== key) {
    setForKey(key);
    setAttempt(0);
    setLoaded(false);
  }
  const sources = buildSources(url, fallbackUrl);

  if (attempt >= sources.length) {
    return (
      <span
        className={
          tileClassName ??
          "flex h-full w-full flex-col items-center justify-center gap-0.5 bg-muted/40 p-1 text-center text-[9px] leading-tight text-muted-foreground"
        }
        title={url}
      >
        <ImageOff className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        <span>Image unavailable</span>
        {linkOnFail && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-full truncate text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Open source link
          </a>
        )}
      </span>
    );
  }

  const waiting = !!loadingClassName && !loaded;

  return (
    <>
      {waiting && (
        <span className={loadingClassName} role="status" aria-label="Loading image">
          <Loader2 className="h-5 w-5 animate-spin opacity-60" aria-hidden />
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sources[attempt]}
        alt={alt}
        loading={loadingClassName ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        className={waiting ? "pointer-events-none absolute h-px w-px opacity-0" : className}
        onLoad={() => setLoaded(true)}
        onError={() => setAttempt((current) => current + 1)}
      />
    </>
  );
}
