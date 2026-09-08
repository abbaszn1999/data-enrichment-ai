import { describe, expect, it } from "vitest";
import { productsRowStoreEnabled } from "./flag";
import {
  dedupeProductsBySku,
  extractProductColumns,
  productSearchText,
  productToRow,
  rowToProduct,
} from "./row-store";
import { incomingQuotaDelta, mergeImportedProducts } from "./import-merge";

describe("products row store helpers", () => {
  it("enables the row store unless PRODUCTS_ROW_STORE=0", () => {
    const previous = process.env.PRODUCTS_ROW_STORE;
    delete process.env.PRODUCTS_ROW_STORE;
    expect(productsRowStoreEnabled()).toBe(true);
    process.env.PRODUCTS_ROW_STORE = "0";
    expect(productsRowStoreEnabled()).toBe(false);
    if (previous === undefined) delete process.env.PRODUCTS_ROW_STORE;
    else process.env.PRODUCTS_ROW_STORE = previous;
  });

  it("builds search text without embedding base64 images", () => {
    const text = productSearchText("SKU-1", {
      title: "Blue Shirt",
      picture: "data:image/png;base64,AAAA",
    });
    expect(text).toContain("sku-1");
    expect(text).toContain("blue shirt");
    expect(text).not.toContain("base64");
  });

  it("round-trips a catalog row through the table shape", () => {
    const product = {
      sku: "A-1",
      data: { Title: "Hat" },
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const row = productToRow("ws-1", product);
    expect(row.workspace_id).toBe("ws-1");
    expect(rowToProduct(row)).toEqual(
      expect.objectContaining({
        sku: "A-1",
        data: { Title: "Hat" },
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      })
    );
  });

  it("records the column manifest from ingest payloads", () => {
    expect(
      extractProductColumns([
        { sku: "1", data: { Title: "A", Brand: "X" } },
        { sku: "2", data: { Title: "B", Color: "red" } },
      ])
    ).toEqual(["Title", "Brand", "Color"]);
  });

  it("merges uploads without requiring the client to hold the catalog", () => {
    const existing = [{ sku: "A", data: { Title: "Old" } }];
    const incoming = [
      { sku: "A", data: { Title: "New" } },
      { sku: "B", data: { Title: "Added" } },
    ];
    const skipped = mergeImportedProducts({
      existing,
      incoming,
      dupMode: "skip",
    });
    expect(skipped.imported).toBe(1);
    expect(skipped.skipped).toBe(1);
    expect(skipped.products.map((p) => p.sku)).toEqual(["A", "B"]);

    const updated = mergeImportedProducts({
      existing,
      incoming,
      dupMode: "update",
    });
    expect(updated.updated).toBe(1);
    expect(updated.imported).toBe(1);
    expect(updated.products[0].data.Title).toBe("New");

    expect(incomingQuotaDelta(new Set(["A"]), incoming, "skip")).toBe(1);
    expect(incomingQuotaDelta(new Set(["A"]), incoming, "new")).toBe(2);
  });

  it("handles duplicate SKUs within the incoming file itself without producing duplicate keys", () => {
    const existing = [{ sku: "A", data: { Title: "Old A" } }];
    const incomingWithDups = [
      { sku: "B", data: { Title: "First B" } },
      { sku: "B", data: { Title: "Second B" } },
      { sku: "C", data: { Title: "First C" } },
      { sku: "A", data: { Title: "Incoming A" } },
    ];

    // Skip mode: ignores subsequent duplicates in incoming
    const skipped = mergeImportedProducts({
      existing,
      incoming: incomingWithDups,
      dupMode: "skip",
    });
    expect(skipped.imported).toBe(2); // First B, First C
    expect(skipped.skipped).toBe(2); // Second B (duplicate of First B), Incoming A (already in existing)
    expect(skipped.products.map((p) => p.sku)).toEqual(["A", "B", "C"]);
    expect(new Set(skipped.products.map((p) => p.sku)).size).toBe(3);

    // Update mode: updates previously inserted/existing
    const updated = mergeImportedProducts({
      existing,
      incoming: incomingWithDups,
      dupMode: "update",
    });
    expect(updated.products.map((p) => p.sku)).toEqual(["A", "B", "C"]);
    expect(updated.products.find((p) => p.sku === "B")?.data.Title).toBe("Second B");
    expect(new Set(updated.products.map((p) => p.sku)).size).toBe(3);

    // New mode: generates unique non-conflicting SKUs
    const newMode = mergeImportedProducts({
      existing,
      incoming: incomingWithDups,
      dupMode: "new",
    });
    expect(newMode.imported).toBe(4);
    const newSkus = newMode.products.map((p) => p.sku);
    expect(new Set(newSkus).size).toBe(newSkus.length); // All SKUs are unique
  });

  it("dedupeProductsBySku ensures all items have unique SKUs", () => {
    const dups = [
      { sku: "SKU-1", data: { Title: "First" } },
      { sku: "SKU-1", data: { Title: "Second" } },
      { sku: "SKU-2", data: { Title: "Other" } },
    ];
    const unique = dedupeProductsBySku(dups);
    expect(unique).toHaveLength(2);
    expect(unique.map((p) => p.sku)).toEqual(["SKU-1", "SKU-2"]);
    expect(unique[0].data.Title).toBe("Second");
  });
});
