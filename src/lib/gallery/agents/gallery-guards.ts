/**
 * Cleans the Gallery agent's answer. The agent makes one request and the
 * skill tells it to copy links exactly as seen; code then guarantees the rest:
 * no image the sheet already has (nor a resized copy of one), no repeat, no
 * known tiny thumbnail (and, in the agent, only links that really load as
 * images). Survivors are ranked (preferred size first) and diversified by
 * perspective.
 */
import { imageFileKey, normalizeImageKey } from "@/lib/enrich/image-finder/evidence";
import type { GalleryScrapingSettings } from "@/lib/gallery/types";

export const GALLERY_PERSPECTIVES = [
  "front",
  "back",
  "side",
  "angle",
  "top",
  "detail",
  "texture",
  "packaging",
  "in_use",
  "lifestyle",
  "scale",
  "lighting",
  "other",
] as const;
export type GalleryPerspective = (typeof GALLERY_PERSPECTIVES)[number];

export interface GalleryAnswer {
  status?: string;
  productIdentity?: string;
  images?: Array<{ url?: string; pageUrl?: string; perspective?: string }>;
  notes?: string;
}

export interface KnownImageSize {
  width?: number;
  height?: number;
}

/** An image link our own tools saw, and the page it was seen on. */
export interface SeenImage {
  imageUrl: string;
  pageUrl: string;
}

export interface GuardedGalleryImage {
  imageUrl: string;
  pageUrl: string;
  perspective: GalleryPerspective;
  width?: number;
  height?: number;
}

export interface GuardedGallery {
  images: GuardedGalleryImage[];
  rejections: string[];
}

/** Below this shortest side a known image is an icon or thumbnail, not a gallery photo. */
export const GALLERY_MIN_USABLE_EDGE = 240;

/** Every key under which an image may be recognised as the same file. */
export function imageIdentityKeys(url: string): string[] {
  const keys = [normalizeImageKey(url)];
  const file = imageFileKey(url);
  if (file) keys.push(file);
  return keys;
}

export function buildKnownImageKeys(urls: string[]): Set<string> {
  const keys = new Set<string>();
  for (const url of urls) for (const key of imageIdentityKeys(url)) keys.add(key);
  return keys;
}

/** Index of seen images by normalised link (size parameters ignored). */
export function buildSeenImageIndex(images: SeenImage[]): Map<string, SeenImage> {
  const index = new Map<string, SeenImage>();
  for (const image of images) {
    const key = normalizeImageKey(image.imageUrl);
    if (!index.has(key)) index.set(key, image);
  }
  return index;
}

function normalizePerspective(value: unknown): GalleryPerspective {
  const text = String(value ?? "").trim().toLowerCase();
  return (GALLERY_PERSPECTIVES as readonly string[]).includes(text) ? (text as GalleryPerspective) : "other";
}

function meetsPreferences(
  size: KnownImageSize | undefined,
  prefs: Pick<GalleryScrapingSettings, "minResolution" | "aspectRatio">
): boolean {
  if (!size?.width || !size.height) return true;
  if (prefs.minResolution > 0 && Math.min(size.width, size.height) < prefs.minResolution) return false;
  const ratio = size.width / size.height;
  switch (prefs.aspectRatio) {
    case "square":
      return ratio >= 0.9 && ratio <= 1.1;
    case "portrait":
      return ratio < 0.9;
    case "landscape":
      return ratio > 1.1;
    default:
      return true;
  }
}

/**
 * One image per perspective first (in ranked order), then the rest. "other"
 * never collides with itself, so unlabeled images keep their rank.
 */
export function diversifyByPerspective<T extends { perspective: GalleryPerspective }>(images: T[]): T[] {
  const first: T[] = [];
  const rest: T[] = [];
  const taken = new Set<GalleryPerspective>();
  for (const image of images) {
    if (image.perspective === "other" || !taken.has(image.perspective)) {
      if (image.perspective !== "other") taken.add(image.perspective);
      first.push(image);
    } else {
      rest.push(image);
    }
  }
  return [...first, ...rest];
}

/**
 * Step 1: which of the model's images are new to the sheet and not repeats.
 * Keeps the model's order.
 */
export function guardGalleryCandidates(input: {
  answer: GalleryAnswer;
  /** Image results the search tool returned; only used to fill in a missing source page. */
  seen?: Map<string, SeenImage>;
  /** Keys from buildKnownImageKeys() of every image the sheet already has. */
  knownImageKeys: Set<string>;
}): GuardedGallery {
  const rejections: string[] = [];
  const kept: GuardedGalleryImage[] = [];
  const taken = new Set<string>();

  for (const item of input.answer.images ?? []) {
    const imageUrl = String(item?.url ?? "").trim().replaceAll("&amp;", "&");
    if (!/^https?:\/\//i.test(imageUrl)) continue;
    const keys = imageIdentityKeys(imageUrl);
    if (keys.some((key) => input.knownImageKeys.has(key))) {
      rejections.push(`${imageUrl}: the sheet already has this image.`);
      continue;
    }
    if (keys.some((key) => taken.has(key))) continue;

    const seen = input.seen?.get(normalizeImageKey(imageUrl));
    for (const key of keys) taken.add(key);
    kept.push({
      imageUrl,
      pageUrl: String(item?.pageUrl ?? "").trim() || seen?.pageUrl || imageUrl,
      perspective: normalizePerspective(item?.perspective),
    });
  }
  return { images: kept, rejections };
}

/**
 * Step 2, after the images were measured: drop known tiny thumbnails, put the
 * images that meet the preferred size and shape first, then spread them over
 * perspectives. An image whose size could not be read is kept.
 */
export function rankGalleryImages(
  images: GuardedGalleryImage[],
  sizes: Map<string, KnownImageSize>,
  prefs: Pick<GalleryScrapingSettings, "minResolution" | "aspectRatio">
): { images: GuardedGalleryImage[]; rejections: string[] } {
  const rejections: string[] = [];
  const sized: GuardedGalleryImage[] = [];
  for (const image of images) {
    const size = sizes.get(normalizeImageKey(image.imageUrl));
    if (size?.width && size.height && Math.min(size.width, size.height) < GALLERY_MIN_USABLE_EDGE) {
      rejections.push(`${image.imageUrl}: too small (${size.width}x${size.height}).`);
      continue;
    }
    sized.push({ ...image, ...(size?.width && size.height ? { width: size.width, height: size.height } : {}) });
  }
  // Stable: images that meet the preferred size and shape first, the model's order otherwise.
  const preferred = sized.filter((image) => meetsPreferences(image, prefs));
  const others = sized.filter((image) => !meetsPreferences(image, prefs));
  return { images: diversifyByPerspective([...preferred, ...others]), rejections };
}
