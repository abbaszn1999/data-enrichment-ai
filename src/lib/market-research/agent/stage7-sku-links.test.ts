import { describe, expect, it } from "vitest";
import { buildArticleSkuTargets, productPath } from "./stage7-sku-links";
import type {
  MarketResearchProduct,
  ProposedCollection,
} from "@/components/market-research/workspace-data";

function product(
  overrides: Partial<MarketResearchProduct> & { id: string }
): MarketResearchProduct {
  return {
    title: `Product ${overrides.id}`,
    handle: overrides.id,
    url: "",
    images: [],
    price: { amount: 10, currency: "USD", priceFormatted: "$10.00" },
    tags: [],
    attributes: [],
    collectionIds: [],
    collectionNames: [],
    inStock: true,
    ...overrides,
  };
}

function collection(
  overrides: Partial<ProposedCollection> & { id: string }
): ProposedCollection {
  return {
    name: `Collection ${overrides.id}`,
    headKeyword: "widgets",
    parentNiche: "widgets",
    volume: 100,
    difficulty: 20,
    productCount: 10,
    keywordCount: 5,
    status: "new",
    ...overrides,
  };
}

describe("productPath", () => {
  it("resolves an absolute Shopify URL to its pathname", () => {
    expect(
      productPath({
        url: "https://mystore.com/products/blue-widget",
        handle: "blue-widget",
      })
    ).toBe("/products/blue-widget");
  });

  it("resolves a WooCommerce permalink to its pathname", () => {
    expect(
      productPath({
        url: "https://mystore.com/shop/blue-widget/",
        handle: "blue-widget",
      })
    ).toBe("/shop/blue-widget/");
  });

  it("keeps an already-relative url as-is", () => {
    expect(
      productPath({ url: "/products/blue-widget", handle: "blue-widget" })
    ).toBe("/products/blue-widget");
  });

  it("prefixes a relative url without a leading slash", () => {
    expect(
      productPath({ url: "products/blue-widget", handle: "blue-widget" })
    ).toBe("/products/blue-widget");
  });

  it("falls back to /products/{handle} when there is no url", () => {
    expect(productPath({ url: "", handle: "blue-widget" })).toBe(
      "/products/blue-widget"
    );
  });

  it("returns an empty string when nothing is resolvable", () => {
    expect(productPath({ url: "", handle: "" })).toBe("");
  });

  it("falls back to the handle when the absolute url is malformed", () => {
    expect(productPath({ url: "https://", handle: "blue-widget" })).toBe(
      "/products/blue-widget"
    );
  });
});

describe("buildArticleSkuTargets", () => {
  it("round-robins across an article's linked collections", () => {
    const p1 = product({ id: "p1", title: "Alpha" });
    const p2 = product({ id: "p2", title: "Beta" });
    const p3 = product({ id: "p3", title: "Gamma" });
    const p4 = product({ id: "p4", title: "Delta" });

    const collectionA = collection({
      id: "colA",
      productMatches: [
        { productId: "p1", score: 0.9 },
        { productId: "p3", score: 0.5 },
      ],
    });
    const collectionB = collection({
      id: "colB",
      productMatches: [
        { productId: "p2", score: 0.95 },
        { productId: "p4", score: 0.6 },
      ],
    });

    const productsById = new Map([
      ["p1", p1],
      ["p2", p2],
      ["p3", p3],
      ["p4", p4],
    ]);

    const result = buildArticleSkuTargets({
      collectionIdsByArticle: { a1: ["colA", "colB"] },
      proposedCollections: [collectionA, collectionB],
      productsById,
      maxPerArticle: 4,
    });

    expect(result.a1.map((link) => link.productName)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
  });

  it("skips out-of-stock, unknown-id, and path-less products", () => {
    const inStock = product({ id: "p1", title: "In Stock" });
    const outOfStock = product({
      id: "p2",
      title: "Out of Stock",
      inStock: false,
    });
    const noPath = product({ id: "p3", title: "No Path", url: "", handle: "" });

    const col = collection({
      id: "col1",
      productMatches: [
        { productId: "p2", score: 0.99 },
        { productId: "p404", score: 0.9 },
        { productId: "p3", score: 0.8 },
        { productId: "p1", score: 0.5 },
      ],
    });

    const productsById = new Map([
      ["p1", inStock],
      ["p2", outOfStock],
      ["p3", noPath],
    ]);

    const result = buildArticleSkuTargets({
      collectionIdsByArticle: { a1: ["col1"] },
      proposedCollections: [col],
      productsById,
    });

    expect(result.a1).toHaveLength(1);
    expect(result.a1[0].productName).toBe("In Stock");
  });

  it("dedupes a product referenced by more than one linked collection", () => {
    const shared = product({ id: "p1", title: "Shared" });
    const other = product({ id: "p2", title: "Other" });

    const colA = collection({
      id: "colA",
      productMatches: [{ productId: "p1", score: 0.9 }],
    });
    const colB = collection({
      id: "colB",
      productMatches: [
        { productId: "p1", score: 0.95 },
        { productId: "p2", score: 0.4 },
      ],
    });

    const productsById = new Map([
      ["p1", shared],
      ["p2", other],
    ]);

    const result = buildArticleSkuTargets({
      collectionIdsByArticle: { a1: ["colA", "colB"] },
      proposedCollections: [colA, colB],
      productsById,
    });

    expect(result.a1.map((link) => link.productName)).toEqual([
      "Shared",
      "Other",
    ]);
  });

  it("caps the result at 5 by default", () => {
    const products = Array.from({ length: 10 }, (_, i) =>
      product({ id: `p${i}`, title: `Product ${i}` })
    );
    const col = collection({
      id: "col1",
      productMatches: products.map((p, i) => ({
        productId: p.id,
        score: 1 - i * 0.01,
      })),
    });
    const productsById = new Map(products.map((p) => [p.id, p]));

    const result = buildArticleSkuTargets({
      collectionIdsByArticle: { a1: ["col1"] },
      proposedCollections: [col],
      productsById,
    });

    expect(result.a1).toHaveLength(5);
  });

  it("returns an empty list for an article with no linked collections", () => {
    const result = buildArticleSkuTargets({
      collectionIdsByArticle: { a1: [] },
      proposedCollections: [],
      productsById: new Map(),
    });

    expect(result.a1).toEqual([]);
  });
});
