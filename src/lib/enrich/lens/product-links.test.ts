import { describe, expect, it } from "vitest";
import { classifyLensLink } from "./product-links";

const verdict = (link: string, extra: { price?: string; inStock?: string } = {}) =>
  classifyLensLink({ link, ...extra });

describe("classifyLensLink", () => {
  it("drops video, social, reference and stock-photo sites", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=abc",
      "https://youtu.be/abc",
      "https://www.facebook.com/shop/item/1",
      "https://www.pinterest.com/pin/1",
      "https://en.wikipedia.org/wiki/Toy",
      "https://www.shutterstock.com/image-photo/toy-1",
      "https://x.com/user/status/1",
    ]) {
      expect(verdict(link).drop, link).toBe("site");
    }
  });

  it("drops home pages and files", () => {
    expect(verdict("https://shop.test").drop).toBe("not_page");
    expect(verdict("https://shop.test/").drop).toBe("not_page");
    expect(verdict("https://shop.test/files/manual.pdf").drop).toBe("not_page");
    expect(verdict("https://cdn.test/img/toy.jpg").drop).toBe("not_page");
  });

  it("drops category, review, article and search pages seen in real Lens results", () => {
    for (const link of [
      "https://www.alza.sk/recenzie/bavytoy-detska-suprava-8589156.htm",
      "https://www.china-toy-expo.com/exhibitor/Shantou-AoHua-Toys-9794",
      "https://shop.test/collections/toys",
      "https://shop.test/category/cars",
      "https://shop.test/blog/best-toys",
      "https://shop.test/catalog?q=car",
    ]) {
      expect(verdict(link).drop, link).toBe("listing");
    }
  });

  it("recognizes product pages by their URL, in several languages", () => {
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
    ]) {
      expect(verdict(link), link).toEqual({ tier: 1 });
    }
  });

  it("ranks a page Google lists a price or stock for first, and never drops it as a listing", () => {
    expect(verdict("https://m.alza.sk/bavytoy-set-d8589156.htm", { price: "€24.06" })).toEqual({ tier: 0 });
    expect(verdict("https://shop.test/collections/toys", { inStock: "In stock" })).toEqual({ tier: 0 });
  });

  it("keeps an unfamiliar page as unknown instead of dropping it", () => {
    expect(verdict("https://kiddyjoy.rs/_dj_piano_sa_zvukom_i_svetlom_igracka_za_bebe-46487")).toEqual({ tier: 2 });
    expect(verdict("https://www.volimsvojdom.rs/muzicka-igracka-za-bebe-dj-klavir-gtcl-1043142")).toEqual({
      tier: 2,
    });
  });

  it("drops a priced match only for a blocked site or a non-page", () => {
    expect(verdict("https://www.pinterest.com/pin/1", { price: "$5" }).drop).toBe("site");
    expect(verdict("https://shop.test/", { price: "$5" }).drop).toBe("not_page");
  });
});
