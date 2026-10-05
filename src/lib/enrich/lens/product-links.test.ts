import { describe, expect, it } from "vitest";
import { buildLensRowContext, classifyLensLink } from "./product-links";

const verdict = (
  link: string,
  extra: { price?: string; inStock?: string; title?: string } = {},
  context?: ReturnType<typeof buildLensRowContext>
) => classifyLensLink({ link, ...extra }, context);

describe("classifyLensLink: removed for certain", () => {
  it("removes video, reference and stock-photo sites", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=abc",
      "https://youtu.be/abc",
      "https://www.pinterest.com/pin/1",
      "https://en.wikipedia.org/wiki/Toy",
      "https://www.shutterstock.com/image-photo/toy-1",
      "https://x.com/user/status/1",
      "https://www.reddit.com/r/toys/comments/1",
    ]) {
      expect(verdict(link).remove, link).toBe("site");
    }
  });

  it("removes files and home pages that say nothing about the row", () => {
    expect(verdict("https://shop.test/files/manual.pdf").remove).toBe("not_page");
    expect(verdict("https://cdn.test/img/toy.jpg").remove).toBe("not_page");
    expect(verdict("https://shop.test/").remove).toBe("not_page");
    expect(verdict("https://unifront.mx/?q=19672296051970").remove).toBe("not_page");
  });

  it("removes review, exhibitor, article and marketplace list pages seen in real Lens results", () => {
    for (const link of [
      "https://www.alza.sk/recenzie/bavytoy-detska-suprava-8589156.htm",
      "https://www.china-toy-expo.com/exhibitor/Shantou-AoHua-Toys-9794",
      "https://shop.test/blog/best-toys",
      "https://www.ebay.co.uk/sch/i.html?_nkw=spiderman+gun",
      "https://www.ebay.co.uk/b/Toy-Guns/19028/bn_1",
      "https://www.amazon.com/s?k=toy+gun",
      "https://www.amazon.com/b/?node=166461011",
      "https://www.walmart.com/browse/toys/4171",
      "https://www.etsy.com/search?q=toy",
      "https://shop.test/product-category/toys/",
      "https://www.amazon.com/product-reviews/B015ZM6B9G",
      "https://listado.mercadolibre.com.ar/juguetes",
    ]) {
      expect(verdict(link).remove, link).toBe("listing");
    }
  });

  it("never removes a page Google lists a price for just because of a list word", () => {
    expect(verdict("https://shop.test/reviews/car-1", { price: "$20*" }).remove).toBeUndefined();
  });
});

describe("classifyLensLink: promoted and demoted", () => {
  it("promotes product URLs in several languages and stores", () => {
    for (const link of [
      "https://www.amazon.ae/HAP-P-KID-Toddler/dp/B0CK2SLGHZ",
      "https://www.walmart.com/ip/Battat-Guitar/5364212103",
      "https://www.ebay.com/itm/386851342641",
      "https://www.mercari.com/us/item/m87931851245/",
      "https://kids-hits.us/products/musical-rainbow",
      "https://ananas.rs/proizvod/interaktivna-igracka/5495101",
      "https://www.pertinitoys.com/product--dj-piano-sa-zvukom-i-svetlom-vgn",
      "https://www.mercadolibre.com.uy/guitarra-musical/up/MLUU4253823328",
      "https://shop.test/collections/toys/products/car",
      "https://shop.test/product/car-123/",
    ]) {
      const result = verdict(link);
      expect(result.remove, link).toBeUndefined();
      expect(result.note, link).toBe("Product page");
    }
  });

  it("ranks a priced page above a product URL, and a product URL above an unknown page", () => {
    const priced = verdict("https://m.alza.sk/bavytoy-set-d8589156.htm", { price: "€24.06" });
    const product = verdict("https://shop.test/products/car");
    const unknown = verdict("https://kiddyjoy.rs/_dj_piano_sa_zvukom_i_svetlom_igracka_za_bebe-46487");
    expect(priced.note).toBe("Price €24.06");
    expect(priced.score).toBeGreaterThan(product.score);
    expect(product.score).toBeGreaterThan(unknown.score);
    expect(unknown.remove).toBeUndefined();
  });

  it("demotes unsure pages instead of removing them", () => {
    for (const link of [
      "https://shop.test/collections/toys",
      "https://shop.test/brand/acme-rc-car",
      "https://shop.test/catalog?q=car",
      "https://www.facebook.com/marketplace/item/123",
      "https://www.instagram.com/p/AbC123/",
    ]) {
      const result = verdict(link);
      expect(result.remove, link).toBeUndefined();
      expect(result.note, link).toBe("Check");
    }
    expect(verdict("https://shop.test/brand/acme-rc-car").score).toBeLessThan(
      verdict("https://shop.test/some-page").score
    );
  });

  it("keeps a home page whose title shows the item's words, demoted", () => {
    const context = buildLensRowContext({ DESC: "Avengers 2.4G 7CH Rolling Drift Stunt Car" });
    const result = verdict("https://brand.test/", { title: "Avengers Rolling Drift Stunt Car" }, context);
    expect(result.remove).toBeUndefined();
    expect(result.note).toBe("Check");
  });
});

describe("row context", () => {
  const context = buildLensRowContext({
    PIC: "vz-storage:abc/def.jpg",
    "P.T NO.": "26022786",
    BARCODE: "3000000101179",
    DESC: "Avengers 2.4G 7CH 360°Rolling Drift Stunt Car",
    LINK: "https://example.com/x",
  });

  it("collects codes and distinctive words, and skips pictures and links", () => {
    expect(context?.identifiers).toEqual(expect.arrayContaining(["26022786", "3000000101179"]));
    expect(context?.words).toEqual(expect.arrayContaining(["avengers", "rolling", "drift", "stunt", "car"]));
    expect(JSON.stringify(context)).not.toMatch(/vz-storage|example\.com/);
  });

  it("raises a page whose title shares the row's words, and never lowers one that does not", () => {
    const matching = verdict("https://a.test/some-page", { title: "Avengers Rolling Drift Stunt Car 2.4G" }, context);
    const foreign = verdict("https://a.test/some-page", { title: "Vozilo za djecu" }, context);
    const plain = verdict("https://a.test/some-page");
    expect(matching.score).toBeGreaterThan(foreign.score);
    expect(matching.note).toBe("Matches your item");
    expect(foreign.score).toBe(plain.score);
  });

  it("gives a code found in the title a strong boost", () => {
    const withCode = verdict("https://a.test/some-page", { title: "Toy EAN 3000000101179" }, context);
    expect(withCode.score).toBeGreaterThanOrEqual(40);
  });

  it("returns nothing when the row has no usable text", () => {
    expect(buildLensRowContext({ PIC: "vz-storage:x.jpg", N: "12" })).toBeUndefined();
    expect(buildLensRowContext(undefined)).toBeUndefined();
  });
});
