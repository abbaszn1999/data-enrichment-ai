import { describe, expect, it } from "vitest";
import { findMarket, marketFromDomain, resolveSearchMarket, SEARCH_MARKETS } from "./markets";

describe("market list", () => {
  it("has unique lowercase codes and plain place names", () => {
    const codes = SEARCH_MARKETS.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const market of SEARCH_MARKETS) {
      expect(market.code).toMatch(/^[a-z]{2}$/);
      expect(market.name.length).toBeGreaterThan(2);
    }
    expect(findMarket("GB")?.name).toBe("United Kingdom");
    expect(findMarket("zz")).toBeNull();
  });
});

describe("marketFromDomain", () => {
  it("reads the country from a country-code ending", () => {
    expect(marketFromDomain("mamasandpapas.co.uk")?.name).toBe("United Kingdom");
    expect(marketFromDomain("shop.uk")?.code).toBe("gb");
    expect(marketFromDomain("shop.de")?.name).toBe("Germany");
    expect(marketFromDomain("store.com.au")?.name).toBe("Australia");
    expect(marketFromDomain("noon.ae")?.name).toBe("United Arab Emirates");
  });

  it("says nothing for global endings, brand endings and unknown countries", () => {
    expect(marketFromDomain("mamasandpapas.com")).toBeNull();
    expect(marketFromDomain("brand.io")).toBeNull();
    expect(marketFromDomain("brand.co")).toBeNull();
    expect(marketFromDomain("brand.shop")).toBeNull();
    expect(marketFromDomain("shop.xx")).toBeNull();
    expect(marketFromDomain("localhost")).toBeNull();
    expect(marketFromDomain(undefined)).toBeNull();
  });
});

describe("resolveSearchMarket", () => {
  it("is automatic by default and follows the website's ending", () => {
    expect(resolveSearchMarket(undefined, "shop.co.uk")).toEqual({ market: { code: "gb", name: "United Kingdom" }, auto: true });
    expect(resolveSearchMarket("auto", "shop.com")).toEqual({ market: null, auto: true });
    expect(resolveSearchMarket("", null)).toEqual({ market: null, auto: true });
  });

  it("lets the owner override Auto with a country or with no location", () => {
    expect(resolveSearchMarket("ae", "shop.co.uk").market?.name).toBe("United Arab Emirates");
    expect(resolveSearchMarket("AE", undefined).auto).toBe(false);
    expect(resolveSearchMarket("none", "shop.co.uk")).toEqual({ market: null, auto: false });
  });

  it("with several websites, Auto picks a country only when they all point to the same one", () => {
    expect(resolveSearchMarket("auto", "a.co.uk, b.uk").market?.code).toBe("gb");
    expect(resolveSearchMarket("auto", "a.co.uk, b.de").market).toBeNull();
    expect(resolveSearchMarket("auto", "a.co.uk, b.com").market).toBeNull();
    expect(resolveSearchMarket("de", "a.co.uk, b.com").market?.code).toBe("de");
  });

  it("sets no location for a code that is not on the list", () => {
    expect(resolveSearchMarket("narnia", "shop.co.uk")).toEqual({ market: null, auto: false });
  });
});
