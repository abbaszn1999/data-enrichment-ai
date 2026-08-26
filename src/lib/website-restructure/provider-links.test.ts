import { describe, expect, it } from "vitest";
import { buildWrStoreLinks } from "./provider-links";

describe("buildWrStoreLinks", () => {
  it("uses WooCommerce's category/search conventions, made absolute against the store's real domain", () => {
    const links = buildWrStoreLinks("woocommerce", "https://mystore.com");
    expect(links).toEqual({
      provider: "woocommerce",
      baseUrl: "https://mystore.com",
      collectionUrlPattern: "https://mystore.com/product-category/{handle}",
      homeUrl: "https://mystore.com/",
      cartUrl: "https://mystore.com/cart",
      searchUrlPattern: "https://mystore.com/?s={query}",
    });
  });

  it("uses Shopify's collection/search conventions, made absolute against the store's real domain", () => {
    const links = buildWrStoreLinks("shopify", "https://mystore.myshopify.com");
    expect(links).toEqual({
      provider: "shopify",
      baseUrl: "https://mystore.myshopify.com",
      collectionUrlPattern: "https://mystore.myshopify.com/collections/{handle}",
      homeUrl: "https://mystore.myshopify.com/",
      cartUrl: "https://mystore.myshopify.com/cart",
      searchUrlPattern: "https://mystore.myshopify.com/search?q={query}",
    });
  });

  it("falls back to the Shopify shape for an unknown/empty provider id", () => {
    const links = buildWrStoreLinks("", "https://mystore.myshopify.com");
    expect(links.provider).toBe("shopify");
    expect(links.collectionUrlPattern).toBe("https://mystore.myshopify.com/collections/{handle}");
  });

  it("never invents a handle — the pattern always keeps the {handle} placeholder", () => {
    for (const provider of ["shopify", "woocommerce"]) {
      const links = buildWrStoreLinks(provider, "https://mystore.example");
      expect(links.collectionUrlPattern).toContain("{handle}");
    }
  });

  it("adds https:// when the stored base URL has no protocol", () => {
    const links = buildWrStoreLinks("shopify", "mystore.myshopify.com");
    expect(links.baseUrl).toBe("https://mystore.myshopify.com");
  });

  it("strips a trailing slash so patterns never end up doubly-slashed", () => {
    const links = buildWrStoreLinks("shopify", "https://mystore.myshopify.com/");
    expect(links.cartUrl).toBe("https://mystore.myshopify.com/cart");
  });

  it("degrades to an empty origin instead of throwing when no base URL is known", () => {
    const links = buildWrStoreLinks("shopify", "");
    expect(links.baseUrl).toBe("");
    expect(links.cartUrl).toBe("/cart");
  });
});
