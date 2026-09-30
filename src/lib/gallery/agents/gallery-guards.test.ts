import { describe, expect, it } from "vitest";
import { EvidenceLedger, normalizeImageKey, normalizePageKey } from "@/lib/enrich/image-finder/evidence";
import { extractRowIdentifiers } from "@/lib/enrich/image-finder/tools/identifiers";
import {
  buildKnownImageKeys,
  diversifyByPerspective,
  guardGalleryAnswer,
  type KnownImageSize,
} from "./gallery-guards";

const rowText = { Title: "Acme Trail Shoe Blue", SKU: "ACM-1234567" };
const rowIdentifiers = extractRowIdentifiers(rowText);

function ledgerWith(pages: Array<{ url: string; images: string[]; identifiers?: boolean; text?: string; status?: number }>) {
  const ledger = new EvidenceLedger();
  for (const page of pages) {
    ledger.recordPage({
      url: page.url,
      finalUrl: page.url,
      status: page.status ?? 200,
      identifiers: page.identifiers === false ? [] : rowIdentifiers,
      imageUrls: page.images,
      matchText: page.text ?? "",
    });
  }
  return ledger;
}

const prefs = { minResolution: 0, aspectRatio: "any" };

function guard(overrides: Partial<Parameters<typeof guardGalleryAnswer>[0]>) {
  return guardGalleryAnswer({
    answer: { images: [] },
    ledger: new EvidenceLedger(),
    rowIdentifiers,
    rowText,
    sourcePageKeys: new Set(),
    knownImageKeys: new Set(),
    prefs,
    ...overrides,
  });
}

describe("guardGalleryAnswer", () => {
  it("keeps an image listed on an opened page that shows the row's code", () => {
    const ledger = ledgerWith([{ url: "https://brand.com/p/acme", images: ["https://cdn.brand.com/img/back-1.jpg"] }]);
    const result = guard({
      ledger,
      answer: {
        images: [{ url: "https://cdn.brand.com/img/back-1.jpg", pageUrl: "https://brand.com/p/acme", perspective: "back" }],
      },
    });
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.perspective).toBe("back");
  });

  it("rejects pages that were never opened, that lack the code, or that do not list the image", () => {
    const ledger = ledgerWith([
      { url: "https://other.com/p/1", images: ["https://cdn.other.com/a.jpg"], identifiers: false },
      { url: "https://brand.com/p/acme", images: ["https://cdn.brand.com/real.jpg"] },
    ]);
    const result = guard({
      ledger,
      answer: {
        images: [
          { url: "https://cdn.x.com/a.jpg", pageUrl: "https://never-opened.com", perspective: "front" },
          { url: "https://cdn.other.com/a.jpg", pageUrl: "https://other.com/p/1", perspective: "front" },
          { url: "https://cdn.brand.com/invented.jpg", pageUrl: "https://brand.com/p/acme", perspective: "front" },
        ],
      },
    });
    expect(result.images).toHaveLength(0);
    expect(result.rejections).toHaveLength(3);
  });

  it("trusts the sheet's own source pages even without a code on them", () => {
    const ledger = ledgerWith([
      { url: "https://shop.com/products/acme-trail", images: ["https://cdn.shop.com/x/side.jpg"], identifiers: false },
    ]);
    const result = guard({
      ledger,
      sourcePageKeys: new Set([normalizePageKey("https://shop.com/products/acme-trail")]),
      answer: {
        images: [{ url: "https://cdn.shop.com/x/side.jpg", pageUrl: "https://shop.com/products/acme-trail", perspective: "side" }],
      },
    });
    expect(result.images).toHaveLength(1);
  });

  it("drops images the sheet already has, including resized CDN copies, and repeats", () => {
    const ledger = ledgerWith([
      {
        url: "https://brand.com/p/acme",
        images: [
          "https://cdn.brand.com/img/main_600x.jpg",
          "https://cdn.brand.com/img/new-angle.jpg",
        ],
      },
    ]);
    const result = guard({
      ledger,
      knownImageKeys: buildKnownImageKeys(["https://cdn.brand.com/img/main.jpg"]),
      answer: {
        images: [
          { url: "https://cdn.brand.com/img/main_600x.jpg", pageUrl: "https://brand.com/p/acme", perspective: "front" },
          { url: "https://cdn.brand.com/img/new-angle.jpg", pageUrl: "https://brand.com/p/acme", perspective: "angle" },
          { url: "https://cdn.brand.com/img/new-angle.jpg", pageUrl: "https://brand.com/p/acme", perspective: "angle" },
        ],
      },
    });
    expect(result.images.map((i) => i.imageUrl)).toEqual(["https://cdn.brand.com/img/new-angle.jpg"]);
  });

  it("matches code-less rows by brand and description words", () => {
    const text = { Title: "Bamboo Cutting Board Large Natural" };
    const ledger = new EvidenceLedger();
    ledger.recordPage({
      url: "https://shop.com/bamboo",
      finalUrl: "https://shop.com/bamboo",
      status: 200,
      identifiers: [],
      imageUrls: ["https://cdn.shop.com/img/bamboo-1.jpg"],
      matchText: " bamboo cutting board large natural ",
    });
    ledger.recordPage({
      url: "https://shop.com/plastic",
      finalUrl: "https://shop.com/plastic",
      status: 200,
      identifiers: [],
      imageUrls: ["https://cdn.shop.com/img/plastic-1.jpg"],
      matchText: " plastic tray small ",
    });
    const result = guardGalleryAnswer({
      answer: {
        images: [
          { url: "https://cdn.shop.com/img/bamboo-1.jpg", pageUrl: "https://shop.com/bamboo", perspective: "front" },
          { url: "https://cdn.shop.com/img/plastic-1.jpg", pageUrl: "https://shop.com/plastic", perspective: "back" },
        ],
      },
      ledger,
      rowIdentifiers: [],
      rowText: text,
      sourcePageKeys: new Set(),
      knownImageKeys: new Set(),
      prefs,
    });
    expect(result.images.map((i) => i.imageUrl)).toEqual(["https://cdn.shop.com/img/bamboo-1.jpg"]);
  });

  it("drops known thumbnails and ranks images that meet the preferred size first", () => {
    const urls = ["https://cdn.b.com/i/small.jpg", "https://cdn.b.com/i/low.jpg", "https://cdn.b.com/i/big.jpg"];
    const ledger = ledgerWith([{ url: "https://b.com/p", images: urls }]);
    const sizes = new Map<string, KnownImageSize>([
      [normalizeImageKey(urls[0]!), { width: 120, height: 120 }],
      [normalizeImageKey(urls[1]!), { width: 800, height: 800 }],
      [normalizeImageKey(urls[2]!), { width: 2000, height: 2000 }],
    ]);
    const result = guard({
      ledger,
      sizes,
      prefs: { minResolution: 1200, aspectRatio: "any" },
      answer: { images: urls.map((url) => ({ url, pageUrl: "https://b.com/p", perspective: "other" })) },
    });
    expect(result.images.map((i) => i.imageUrl)).toEqual([urls[2], urls[1]]);
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
