"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/** Same-origin, inline and blob images need no proxy. */
function needsProxy(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function proxiedImageSrc(url: string): string {
  return needsProxy(url) ? `/api/image-proxy?url=${encodeURIComponent(url)}` : url;
}

/**
 * A sheet image that keeps working when the store's link goes stale or blocks
 * hot-linking: it loads through our cached proxy first (a week in the CDN, so
 * re-opening a sheet is fast), then tries the original link, and if both fail
 * shows an "Image unavailable" tile instead of a broken image. The stored link
 * is never changed, so exports still carry the original URL.
 */
export function SheetImage({
  url,
  alt,
  className,
  tileClassName,
  linkOnFail = false,
}: {
  url: string;
  alt: string;
  /** Classes for the loaded image. */
  className?: string;
  /** Classes for the "Image unavailable" tile; defaults to filling the same box as the image. */
  tileClassName?: string;
  /** Show the original link under the tile (for large previews). */
  linkOnFail?: boolean;
}) {
  // 0 = proxy, 1 = original link, 2 = failed.
  const [stage, setStage] = useState<0 | 1 | 2>(needsProxy(url) ? 0 : 1);
  const [forUrl, setForUrl] = useState(url);
  if (forUrl !== url) {
    setForUrl(url);
    setStage(needsProxy(url) ? 0 : 1);
  }

  if (stage === 2) {
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

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={stage === 0 ? proxiedImageSrc(url) : url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setStage((current) => (current === 0 ? 1 : 2))}
    />
  );
}
