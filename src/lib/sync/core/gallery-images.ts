// Shared representation of a product's image gallery (every image except the
// featured one), used by both providers and by the agent's image search.
//
// Two columns model a gallery:
//   `gallery_images` — visible cell: the desired URLs, in order, as text.
//   `gallery_media`  — hidden cell: [{ id, src }] as returned by the platform.
//
// The hidden column is what makes updates safe. WooCommerce treats `images` as
// the complete desired state and re-downloads any entry passed as `src`, so
// existing pictures must be referenced by their media ID or they get duplicated
// (and anything omitted is deleted outright). Keeping the platform IDs next to
// the URLs lets us rebuild that array losslessly, and on Shopify it tells us
// which URLs are already attached so we append only what is genuinely new.

/** Canonical separator for the visible gallery cell. */
export const GALLERY_SEPARATOR = " | ";

export const GALLERY_IMAGES_COLUMN = "gallery_images";
export const GALLERY_MEDIA_COLUMN = "gallery_media";

/** Images fetched per product when the user names no number. */
export const DEFAULT_GALLERY_IMAGE_COUNT = 4;
/** Hard ceiling even when the user asks for more. */
export const MAX_GALLERY_IMAGE_COUNT = 6;

/** Shopify caps media (images + video + 3D) per product; verified 2026-04. */
export const SHOPIFY_MAX_MEDIA_PER_PRODUCT = 250;

export type GalleryMediaEntry = {
  /** Platform media ID (Shopify MediaImage GID, WooCommerce attachment ID). */
  id: string;
  /** URL the platform currently serves for that media. */
  src: string;
};

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Splits a gallery cell into URLs.
 *
 * Deliberately does NOT split on commas: commas are legal, unescaped characters
 * inside image URLs (Cloudinary transformation segments like `w_400,h_400` are
 * the common case), so comma-splitting would shred real URLs. Newlines, pipes
 * and whitespace cannot appear unencoded in a URL, which makes them safe.
 */
export function parseGalleryImages(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupeUrls(value.map(toText).filter(Boolean));
  }
  const text = toText(value);
  if (!text) return [];
  return dedupeUrls(
    text
      .split(/[\s|]+/)
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

export function serializeGalleryImages(urls: readonly string[]): string {
  return dedupeUrls(urls.map(toText).filter(Boolean)).join(GALLERY_SEPARATOR);
}

/** Case-insensitive key so the same URL in different casing counts once. */
export function galleryUrlKey(url: unknown): string {
  return toText(url).toLowerCase();
}

export function dedupeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const clean = toText(url);
    if (!clean) continue;
    const key = galleryUrlKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** Reads the hidden `gallery_media` cell, tolerating a JSON string round-trip. */
export function parseGalleryMedia(value: unknown): GalleryMediaEntry[] {
  const raw = (() => {
    if (Array.isArray(value)) return value;
    const text = toText(value);
    if (!text.startsWith("[")) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const out: GalleryMediaEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const src = toText(record.src);
    const id = toText(record.id);
    if (!src && !id) continue;
    out.push({ id, src });
  }
  return out;
}

/** Lookup from URL → platform media ID for the images already on the product. */
export function buildGalleryMediaIndex(
  value: unknown
): Map<string, GalleryMediaEntry> {
  const index = new Map<string, GalleryMediaEntry>();
  for (const entry of parseGalleryMedia(value)) {
    if (!entry.src) continue;
    const key = galleryUrlKey(entry.src);
    if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

/**
 * Clamps how many gallery images one search may fetch per product.
 * No number from the user → DEFAULT; a number → capped at MAX.
 */
export function clampGalleryImageCount(requested?: unknown): number {
  const num = Number(requested);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_GALLERY_IMAGE_COUNT;
  return Math.min(Math.max(1, Math.floor(num)), MAX_GALLERY_IMAGE_COUNT);
}

/**
 * Merges freshly found URLs into an existing gallery.
 * Drops blanks, duplicates, and anything already used as the featured image —
 * a gallery that repeats the main picture looks broken on the storefront.
 */
export function mergeGalleryImages(params: {
  existing: unknown;
  incoming: readonly string[];
  featuredImage?: unknown;
  /** Replace the gallery instead of appending to it. */
  overwrite?: boolean;
}): { urls: string[]; added: string[]; skipped: number } {
  const featuredKey = galleryUrlKey(params.featuredImage);
  const existing = params.overwrite ? [] : parseGalleryImages(params.existing);
  const taken = new Set(existing.map(galleryUrlKey));
  if (featuredKey) taken.add(featuredKey);

  const added: string[] = [];
  let skipped = 0;
  for (const candidate of params.incoming) {
    const clean = toText(candidate);
    if (!clean) {
      skipped += 1;
      continue;
    }
    const key = galleryUrlKey(clean);
    if (taken.has(key)) {
      skipped += 1;
      continue;
    }
    taken.add(key);
    added.push(clean);
  }

  return { urls: [...existing, ...added], added, skipped };
}
