"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { getImageSignedUrl } from "@/lib/storage-helpers";
import { splitStoredImageRefs, storedImagePath } from "@/lib/stored-image-ref";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const LINK_TTL_SEC = 3600;
const REUSE_MS = (LINK_TTL_SEC - 300) * 1000;

const linkCache = new Map<string, { url: string; at: number }>();
const pending = new Map<string, Promise<string | null>>();

function signedLink(path: string): Promise<string | null> {
  const cached = linkCache.get(path);
  if (cached && Date.now() - cached.at < REUSE_MS) return Promise.resolve(cached.url);
  const inFlight = pending.get(path);
  if (inFlight) return inFlight;
  const request = getImageSignedUrl(path, LINK_TTL_SEC)
    .then((url) => {
      if (url) linkCache.set(path, { url, at: Date.now() });
      return url;
    })
    .catch(() => null)
    .finally(() => pending.delete(path));
  pending.set(path, request);
  return request;
}

export function useStoredImageLink(path: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(() => linkCache.get(path)?.url);
  useEffect(() => {
    let alive = true;
    signedLink(path).then((link) => {
      if (alive) setUrl(link);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

function StoredImageThumb({ path, size }: { path: string; size: string }) {
  const url = useStoredImageLink(path);
  if (url === null) {
    return (
      <span
        title="Picture could not be loaded"
        className={`flex ${size} items-center justify-center rounded border border-border/40 bg-muted/30 text-muted-foreground`}
      >
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  if (!url) return <span className={`${size} animate-pulse rounded border border-border/40 bg-muted/40`} />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <img
          src={url}
          alt="Sheet picture"
          loading="lazy"
          className={`${size} rounded border border-border/40 bg-white object-contain`}
        />
      </TooltipTrigger>
      <TooltipContent side="right" className="p-1">
        <img src={url} alt="Sheet picture" className="max-h-56 max-w-56 rounded object-contain" />
      </TooltipContent>
    </Tooltip>
  );
}

/** Thumbnails for a cell that holds pictures saved from the uploaded sheet. */
export function StoredImageCell({ value, size = "h-10 w-10" }: { value: string; size?: string }) {
  const paths = splitStoredImageRefs(value).map(storedImagePath);
  if (paths.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {paths.slice(0, 3).map((path) => (
        <StoredImageThumb key={path} path={path} size={size} />
      ))}
      {paths.length > 3 && <span className="text-[10px] text-muted-foreground">+{paths.length - 3}</span>}
    </div>
  );
}
