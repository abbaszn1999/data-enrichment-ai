import { describe, expect, it } from "vitest";
import { findMarket, resolveSearchMarket, SEARCH_MARKETS } from "./markets";

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

describe("resolveSearchMarket", () => {
  it("uses the country the owner picked, in any letter case", () => {
    expect(resolveSearchMarket("gb")).toEqual({ code: "gb", name: "United Kingdom" });
    expect(resolveSearchMarket("AE")?.name).toBe("United Arab Emirates");
  });

  it("sets no location when nothing, any country or the older Auto is chosen", () => {
    expect(resolveSearchMarket(undefined)).toBeNull();
    expect(resolveSearchMarket("")).toBeNull();
    expect(resolveSearchMarket("none")).toBeNull();
    expect(resolveSearchMarket("auto")).toBeNull();
  });

  it("sets no location for a code that is not on the list", () => {
    expect(resolveSearchMarket("narnia")).toBeNull();
  });
});