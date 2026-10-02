import { describe, expect, it } from "vitest";
import { normalizeImageKey } from "@/lib/enrich/image-finder/evidence";
import {
  buildKnownImageKeys,
  buildSeenImageIndex,
  diversifyByPerspective,
  guardGalleryCandidates,
  rankGalleryImages,
  type GuardedGalleryImage,
  type KnownImageSize,
} from "./gallery-guards";

const prefs = { minResolution: 0, aspectRatio: "any" };

function guard(
  images: Array<{ url: string; pageUrl?: string; perspective?: string }>,
  seen: Array<{ imageUrl: string; pageUrl: string }>,
  known: string[] = []
) {
  return guardGalleryCandidates({
    answer: { images: images.map((i) => ({ pageUrl: "", perspective: "other", ...i })) },
    seen: buildSeenImageIndex(seen),
    knownImageKeys: buildKnownImageKeys(known),
  });
}

describe("guardGalleryCandidates", () => {
  it("keeps the model's link and its page, and ignores non-http values", () => {
    const result = guard(
      [
        { url: "https://cdn.brand.com/img/back-1.jpg", pageUrl: "https://brand.com/p/acme", perspective: "back" },
        { url: "not a link" },
      ],
      []
    );
    expect(result.images).toEqual([
      { imageUrl: "https://cdn.brand.com/img/back-1.jpg", pageUrl: "https://brand.com/p/acme", perspective: "back" },
    ]);
  });

  it("fills a missing page from the search results whatever size parameter the link carries", () => {
    const result = guard(
      [{ url: "https://cdn.shop.com/x/side.jpg?width=1200" }],
      [{ imageUrl: "https://cdn.shop.com/x/side.jpg?width=400", pageUrl: "https://shop.com/p" }]
    );
    expect(result.images[0]!.pageUrl).toBe("https://shop.com/p");
  });

  it("drops images the sheet already has, including resized copies, and repeats", () => {
    const seen = [
      { imageUrl: "https://cdn.brand.com/img/main_600x.jpg", pageUrl: "https://brand.com/p" },
      { imageUrl: "https://cdn.brand.com/img/new-angle.jpg", pageUrl: "https://brand.com/p" },
    ];
    const result = guard(
      [
        { url: "https://cdn.brand.com/img/main_600x.jpg" },
        { url: "https://cdn.brand.com/img/new-angle.jpg" },
        { url: "https://cdn.brand.com/img/new-angle.jpg" },
      ],
      seen,
      ["https://cdn.brand.com/img/main.jpg"]
    );
    expect(result.images.map((i) => i.imageUrl)).toEqual(["https://cdn.brand.com/img/new-angle.jpg"]);
  });

  it("falls back to the image link itself when no page is known", () => {
    const result = guard([{ url: "https://cdn.a.com/i/2.jpg" }], []);
    expect(result.images[0]!.pageUrl).toBe("https://cdn.a.com/i/2.jpg");
  });
});

describe("rankGalleryImages", () => {
  const image = (url: string, perspective: GuardedGalleryImage["perspective"] = "other"): GuardedGalleryImage => ({
    imageUrl: url,
    pageUrl: "https://b.com/p",
    perspective,
  });

  it("drops known thumbnails and ranks images that meet the preferred size first", () => {
    const urls = ["https://cdn.b.com/i/small.jpg", "https://cdn.b.com/i/low.jpg", "https://cdn.b.com/i/big.jpg"];
    const sizes = new Map<string, KnownImageSize>([
      [normalizeImageKey(urls[0]!), { width: 120, height: 120 }],
      [normalizeImageKey(urls[1]!), { width: 800, height: 800 }],
      [normalizeImageKey(urls[2]!), { width: 2000, height: 2000 }],
    ]);
    const result = rankGalleryImages(urls.map((url) => image(url)), sizes, { minResolution: 1200, aspectRatio: "any" });
    expect(result.images.map((i) => i.imageUrl)).toEqual([urls[2], urls[1]]);
    expect(result.rejections).toHaveLength(1);
  });

  it("keeps an image whose size could not be read", () => {
    const result = rankGalleryImages([image("https://cdn.b.com/i/unknown.jpg")], new Map(), {
      minResolution: 1200,
      aspectRatio: "square",
    });
    expect(result.images).toHaveLength(1);
  });

  it("honours the preferred aspect ratio ordering", () => {
    const wide = "https://cdn.b.com/i/wide.jpg";
    const square = "https://cdn.b.com/i/square.jpg";
    const sizes = new Map<string, KnownImageSize>([
      [normalizeImageKey(wide), { width: 1600, height: 900 }],
      [normalizeImageKey(square), { width: 1000, height: 1000 }],
    ]);
    const result = rankGalleryImages([image(wide), image(square)], sizes, { ...prefs, aspectRatio: "square" });
    expect(result.images.map((i) => i.imageUrl)).toEqual([square, wide]);
  });
});

describe("diversifyByPerspective", () => {
  it("takes one image per perspective before repeats and never merges 'other'", () => {
    const ordered = diversifyByPerspective([
      { id: 1, perspective: "front" as const },
      { id: 2, perspective: "front" as const },
      { id: 3, perspective: "back" as const },
      { id: 4, perspective: "other" as const },
      { id: 5, perspective: "other" as const },
    ]);
    expect(ordered.map((i) => i.id)).toEqual([1, 3, 4, 5, 2]);
  });
});
