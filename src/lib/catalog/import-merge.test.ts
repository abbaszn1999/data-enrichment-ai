import { describe, expect, it } from "vitest";
import {
  incomingQuotaDelta,
  isBlankImportValue,
  mergeImportedProductData,
  mergeImportedProducts,
} from "./import-merge";

describe("isBlankImportValue", () => {
  it("treats null, undefined, and whitespace as blank", () => {
    expect(isBlankImportValue(null)).toBe(true);
    expect(isBlankImportValue(undefined)).toBe(true);
    expect(isBlankImportValue("")).toBe(true);
    expect(isBlankImportValue("   ")).toBe(true);
  });

  it("keeps real values, including numeric zero", () => {
    expect(isBlankImportValue("Logitech")).toBe(false);
    expect(isBlankImportValue("0")).toBe(false);
    expect(isBlankImportValue(0)).toBe(false);
    expect(isBlankImportValue(false)).toBe(false);
  });
});

describe("mergeImportedProductData", () => {
  it("keeps existing values when incoming cells are blank", () => {
    expect(
      mergeImportedProductData(
        { Title: "Mouse", Brand: "Logitech", Price: "29.99" },
        { Title: "Mouse Pro", Brand: "", Price: "32.00" },
        false
      )
    ).toEqual({ Title: "Mouse Pro", Brand: "Logitech", Price: "32.00" });
  });

  it("clears existing values when the merchant opts in", () => {
    expect(
      mergeImportedProductData(
        { Title: "Mouse", Brand: "Logitech" },
        { Title: "Mouse Pro", Brand: "" },
        true
      )
    ).toEqual({ Title: "Mouse Pro", Brand: "" });
  });

  it("adds new non-blank columns without dropping old ones", () => {
    expect(
      mergeImportedProductData(
        { Title: "Mouse" },
        { Title: "", Color: "black", Extra: "   " },
        false
      )
    ).toEqual({ Title: "Mouse", Color: "black" });
  });
});

describe("mergeImportedProducts update empty cells", () => {
  const existing = [
    {
      sku: "SKU-1",
      data: { Title: "Wireless Mouse", Brand: "Logitech", Price: "29.99" },
      status: "active",
      categoryId: "mice",
      enrichedData: { seo: "kept" },
    },
  ];

  it("does not wipe catalog fields when the upload leaves cells empty", () => {
    const result = mergeImportedProducts({
      existing,
      incoming: [
        {
          sku: "SKU-1",
          data: { Title: "Wireless Mouse Pro", Brand: "", Price: "32.00" },
        },
      ],
      dupMode: "update",
    });

    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.products[0]).toMatchObject({
      sku: "SKU-1",
      status: "active",
      categoryId: "mice",
      enrichedData: { seo: "kept" },
      data: {
        Title: "Wireless Mouse Pro",
        Brand: "Logitech",
        Price: "32.00",
      },
    });
  });

  it("clears catalog fields only when clearEmptyFields is true", () => {
    const result = mergeImportedProducts({
      existing,
      incoming: [
        {
          sku: "SKU-1",
          data: { Title: "Wireless Mouse Pro", Brand: "  ", Price: "32.00" },
        },
      ],
      dupMode: "update",
      clearEmptyFields: true,
    });

    expect(result.products[0].data).toEqual({
      Title: "Wireless Mouse Pro",
      Brand: "  ",
      Price: "32.00",
    });
  });

  it("still inserts SKUs that are not in the catalog", () => {
    const result = mergeImportedProducts({
      existing,
      incoming: [{ sku: "SKU-2", data: { Title: "Keyboard", Brand: "" } }],
      dupMode: "update",
    });

    expect(result.updated).toBe(0);
    expect(result.imported).toBe(1);
    expect(result.products.map((p) => p.sku)).toEqual(["SKU-1", "SKU-2"]);
    expect(result.products[1].data).toEqual({ Title: "Keyboard", Brand: "" });
  });

  it("does not change skip or new behavior", () => {
    const skipped = mergeImportedProducts({
      existing,
      incoming: [
        { sku: "SKU-1", data: { Title: "Changed", Brand: "" } },
        { sku: "SKU-2", data: { Title: "New" } },
      ],
      dupMode: "skip",
      clearEmptyFields: true,
    });
    expect(skipped.skipped).toBe(1);
    expect(skipped.products[0].data.Brand).toBe("Logitech");
    expect(skipped.products[0].data.Title).toBe("Wireless Mouse");

    const created = mergeImportedProducts({
      existing,
      incoming: [{ sku: "SKU-1", data: { Title: "Changed", Brand: "" } }],
      dupMode: "new",
      clearEmptyFields: true,
    });
    expect(created.imported).toBe(1);
    expect(created.products.map((p) => p.sku)).toEqual(["SKU-1", "SKU-1_dup_1"]);
    expect(created.products[0].data.Brand).toBe("Logitech");
  });

  it("counts quota only for new SKUs in update mode", () => {
    expect(
      incomingQuotaDelta(
        new Set(["SKU-1"]),
        [
          { sku: "SKU-1", data: { Title: "" } },
          { sku: "SKU-2", data: { Title: "New" } },
        ],
        "update"
      )
    ).toBe(1);
  });
});
