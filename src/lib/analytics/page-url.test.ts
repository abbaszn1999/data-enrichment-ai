import { describe, expect, it } from "vitest";
import { analyticsPageHref, gscPropertyOrigin } from "./page-url";

describe("gscPropertyOrigin", () => {
  it("turns domain properties into https origins", () => {
    expect(gscPropertyOrigin("sc-domain:example.com")).toBe("https://example.com");
  });

  it("keeps URL-prefix properties as origin only", () => {
    expect(gscPropertyOrigin("https://www.shop.com/en/")).toBe("https://www.shop.com");
  });
});

describe("analyticsPageHref", () => {
  it("keeps full Search Console URLs", () => {
    expect(analyticsPageHref("https://shop.com/collections/hats")).toBe("https://shop.com/collections/hats");
  });

  it("joins GA4 paths onto the Search Console origin", () => {
    expect(analyticsPageHref("/products/sku-1", "sc-domain:shop.com")).toBe("https://shop.com/products/sku-1");
  });

  it("hides relative links when no site property is known", () => {
    expect(analyticsPageHref("/products/sku-1")).toBeNull();
  });
});
