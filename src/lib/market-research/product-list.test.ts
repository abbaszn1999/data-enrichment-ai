import { describe, expect, it } from "vitest";
import type { MarketResearchProduct } from "@/components/market-research/workspace-data";
import {
  MAX_PRODUCT_LIST_IDS,
  parseProductIdQuery,
  selectProductsByIds,
} from "./product-list";

function product(id: string): MarketResearchProduct {
  return {
    id,
    title: id,
    handle: id,
    url: `/products/${id}`,
    images: [],
    price: { amount: 1, currency: "USD", priceFormatted: "$1.00" },
    tags: [],
    attributes: [],
    collectionIds: [],
    collectionNames: [],
    inStock: true,
  };
}

describe("parseProductIdQuery", () => {
  it("returns an empty list when ids are omitted", () => {
    expect(parseProductIdQuery(null)).toEqual([]);
    expect(parseProductIdQuery("")).toEqual([]);
  });

  it("parses, trims, and dedupes comma-separated ids", () => {
    expect(parseProductIdQuery(" a, b, a, c ")).toEqual(["a", "b", "c"]);
  });

  it(`caps at ${MAX_PRODUCT_LIST_IDS} ids`, () => {
    const raw = Array.from({ length: MAX_PRODUCT_LIST_IDS + 25 }, (_, i) => `p${i}`).join(
      ","
    );
    const ids = parseProductIdQuery(raw);
    expect(ids).toHaveLength(MAX_PRODUCT_LIST_IDS);
    expect(ids[0]).toBe("p0");
    expect(ids.at(-1)).toBe(`p${MAX_PRODUCT_LIST_IDS - 1}`);
  });
});

describe("selectProductsByIds", () => {
  const catalog = [product("a"), product("b"), product("c")];

  it("returns the full catalog when no ids are requested", () => {
    expect(selectProductsByIds(catalog, [])).toEqual(catalog);
  });

  it("returns only the requested products in catalog order", () => {
    expect(selectProductsByIds(catalog, ["c", "a"]).map((p) => p.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("ignores unknown ids", () => {
    expect(selectProductsByIds(catalog, ["missing", "b"]).map((p) => p.id)).toEqual([
      "b",
    ]);
  });
});
