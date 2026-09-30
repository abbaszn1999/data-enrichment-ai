/**
 * Accepts the Gallery agent's answer only where our own tools' record backs
 * it up. An image is kept when:
 *  - the page it cites was opened successfully and really lists that image;
 *  - that page is evidence of the exact item (a known source page of the
 *    sheet, or a page that shows the row's identifier, or - for rows with no
 *    code - a page that matches the row's brand and description);
 *  - it is not an image the sheet already has, nor a resized copy of one, nor
 *    a repeat of another returned image;
 *  - it is not a known tiny thumbnail.
 * Survivors are ranked (preferred size first) and diversified by perspective.
 */
import {
  imageFileKey,
  isOkPage,
  normalizeImageKey,
  normalizePageKey,
  pageShowsImage,
  type EvidenceLedger,
  type PageEvidence,
} from "@/lib/enrich/image-finder/evidence";
import {
  distinctiveWords,
  isSpecificPartNumber,
  wordsPresentRatio,
  type RowIdentifier,
} from "@/lib/enrich/image-finder/tools/identifiers";
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
/** Share of a code-less row's distinctive words a page must show. */
export const GALLERY_BEST_MATCH_MIN_WORD_SHARE = 0.6;
export const GALLERY_BEST_MATCH_MIN_WORDS = 2;

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

function normalizePerspective(value: unknown): GalleryPerspective {
  const text = String(value ?? "").trim().toLowerCase();
  return (GALLERY_PERSPECTIVES as readonly string[]).includes(text) ? (text as GalleryPerspective) : "other";
}

function makePagePasses(input: {
  rowIdentifiers: RowIdentifier[];
  rowText: Record<string, string>;
  sourcePageKeys: Set<string>;
}): (evidence: PageEvidence) => boolean {
  const { rowIdentifiers, rowText, sourcePageKeys } = input;
  const exactKeys = rowIdentifiers.filter((id) => id.strong || isSpecificPartNumber(id.key)).map((id) => id.key);
  const allKeys = rowIdentifiers.map((id) => id.key);
  const words = distinctiveWords(rowText);
  return (evidence) => {
    if (sourcePageKeys.has(normalizePageKey(evidence.url)) || sourcePageKeys.has(normalizePageKey(evidence.finalUrl))) {
      return true;
    }
    if (exactKeys.length > 0) return exactKeys.some((key) => evidence.identifierKeys.has(key));
    if (allKeys.length > 0) return allKeys.every((key) => evidence.identifierKeys.has(key));
    return (
      words.length >= GALLERY_BEST_MATCH_MIN_WORDS &&
      wordsPresentRatio(words, evidence.matchText) >= GALLERY_BEST_MATCH_MIN_WORD_SHARE
    );
  };
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

export function guardGalleryAnswer(input: {
  answer: GalleryAnswer;
  ledger: EvidenceLedger;
  rowIdentifiers: RowIdentifier[];
  /** Text-only row values (URL cells removed). */
  rowText: Record<string, string>;
  /** normalizePageKey() of the sheet's known source pages. */
  sourcePageKeys: Set<string>;
  /** Keys from buildKnownImageKeys() of every image the sheet already has. */
  knownImageKeys: Set<string>;
  /** Sizes reported by view_images, keyed by normalizeImageKey(). */
  sizes?: Map<string, KnownImageSize>;
  prefs: Pick<GalleryScrapingSettings, "minResolution" | "aspectRatio">;
}): GuardedGallery {
  const pagePasses = makePagePasses(input);
  const rejections: string[] = [];
  const kept: GuardedGalleryImage[] = [];
  const seen = new Set<string>();

  for (const item of input.answer.images ?? []) {
    const imageUrl = String(item?.url ?? "").trim().replaceAll("&amp;", "&");
    if (!/^https?:\/\//i.test(imageUrl)) continue;
    const keys = imageIdentityKeys(imageUrl);
    if (keys.some((key) => input.knownImageKeys.has(key))) {
      rejections.push(`${imageUrl}: the sheet already has this image.`);
      continue;
    }
    if (keys.some((key) => seen.has(key))) continue;

    const pageUrl = String(item?.pageUrl ?? "").trim();
    const source = pageUrl ? input.ledger.find(pageUrl) : undefined;
    if (!isOkPage(source)) {
      rejections.push(`${imageUrl}: its page ${pageUrl || "(none)"} was not opened.`);
      continue;
    }
    if (!pagePasses(source)) {
      rejections.push(`${imageUrl}: its page ${pageUrl} does not show the same item.`);
      continue;
    }
    if (!pageShowsImage(source, imageUrl)) {
      rejections.push(`${imageUrl}: this link does not appear on ${pageUrl}.`);
      continue;
    }
    const size = input.sizes?.get(normalizeImageKey(imageUrl));
    if (size?.width && size.height && Math.min(size.width, size.height) < GALLERY_MIN_USABLE_EDGE) {
      rejections.push(`${imageUrl}: too small (${size.width}x${size.height}).`);
      continue;
    }
    for (const key of keys) seen.add(key);
    kept.push({
      imageUrl,
      pageUrl,
      perspective: normalizePerspective(item?.perspective),
      ...(size?.width && size.height ? { width: size.width, height: size.height } : {}),
    });
  }

  // Stable: images that meet the preferred size and shape first, the model's order otherwise.
  const preferred = kept.filter((image) => meetsPreferences(image, input.prefs));
  const others = kept.filter((image) => !meetsPreferences(image, input.prefs));
  return { images: diversifyByPerspective([...preferred, ...others]), rejections };
}
