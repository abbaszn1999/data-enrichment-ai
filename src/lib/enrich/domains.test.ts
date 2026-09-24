import { describe, expect, it } from "vitest";
import {
  MAX_DOMAIN_RULES,
  filterImagesByDomainRules,
  normalizeDomain,
  parseDomainList,
  sanitizeDomainRules,
} from "./domains";

describe("normalizeDomain", () => {
  it("reduces URLs and casing to a bare domain", () => {
    expect(normalizeDomain("https://www.LEGO.com/en-us/product?x=1")).toBe("lego.com");
    expect(normalizeDomain("shop.hasbro.com")).toBe("shop.hasbro.com");
    expect(normalizeDomain("*.amazon.co.uk")).toBe("amazon.co.uk");
    expect(normalizeDomain("example.com:8080/path")).toBe("example.com");
  });

  it("rejects things that are not domains", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("lego")).toBeNull();
    expect(normalizeDomain("not a site")).toBeNull();
    expect(normalizeDomain("-bad.com")).toBeNull();
    expect(normalizeDomain("bad-.com")).toBeNull();
  });
});

describe("parseDomainList", () => {
  it("splits lines, commas and spaces, dedupes, and reports invalid entries", () => {
    expect(parseDomainList("lego.com\nwww.lego.com, hasbro.com  nope")).toEqual({
      domains: ["lego.com", "hasbro.com"],
      invalid: ["nope"],
    });
  });
});

describe("sanitizeDomainRules", () => {
  it("drops junk, caps each list, and lets a block win over an allow", () => {
    const many = Array.from({ length: 150 }, (_, i) => `site${i}.com`);
    const rules = sanitizeDomainRules({
      allowedDomains: ["lego.com", 42, "pinterest.com", ...many],
      blockedDomains: ["pinterest.com", null],
    });
    expect(rules.blockedDomains).toEqual(["pinterest.com"]);
    expect(rules.allowedDomains).not.toContain("pinterest.com");
    expect(rules.allowedDomains[0]).toBe("lego.com");
    expect(rules.allowedDomains.length).toBeLessThanOrEqual(MAX_DOMAIN_RULES);
  });

  it("returns empty lists for missing input", () => {
    expect(sanitizeDomainRules({})).toEqual({ allowedDomains: [], blockedDomains: [] });
  });
});

describe("filterImagesByDomainRules", () => {
  const images = [
    { imageUrl: "https://cdn.shopify.com/lego-1.jpg", pageUrl: "https://www.lego.com/p/1" },
    { imageUrl: "https://i.pinimg.com/x.jpg", pageUrl: "https://www.pinterest.com/pin/1" },
    { imageUrl: "https://images.lego.com/2.jpg", pageUrl: "https://www.amazon.com/dp/2" },
    { imageUrl: "https://m.media-amazon.com/3.jpg", pageUrl: "https://www.amazon.com/dp/3" },
  ];

  it("keeps everything when no rules are set", () => {
    expect(
      filterImagesByDomainRules(images, { allowedDomains: [], blockedDomains: [] })
    ).toHaveLength(4);
  });

  it("keeps only images whose page or file is on an allowed site (subdomains included)", () => {
    const kept = filterImagesByDomainRules(images, {
      allowedDomains: ["lego.com"],
      blockedDomains: [],
    });
    expect(kept.map((i) => i.imageUrl)).toEqual([
      "https://cdn.shopify.com/lego-1.jpg",
      "https://images.lego.com/2.jpg",
    ]);
  });

  it("drops images whose page or file is on a blocked site", () => {
    const kept = filterImagesByDomainRules(images, {
      allowedDomains: [],
      blockedDomains: ["pinterest.com", "amazon.com"],
    });
    expect(kept.map((i) => i.imageUrl)).toEqual(["https://cdn.shopify.com/lego-1.jpg"]);
  });
});
