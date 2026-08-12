import { describe, expect, it } from "vitest";

import {
  PROTECTED_COLUMNS,
  isProtectedColumn,
  protectedColumnRefusal,
  stripProtectedColumns,
} from "./protected-columns";
import { getAllWritableColumns, PROVIDERS } from "./registry";

describe("protected column registry", () => {
  it("covers every identity, URL, and inventory field", () => {
    expect(Object.keys(PROTECTED_COLUMNS).sort()).toEqual([
      "barcode",
      "global_unique_id",
      "handle",
      "inventory_total",
      "manage_stock",
      "primary_sku",
      "stock_status",
    ]);
  });

  it("keeps protected columns out of every provider's writable surface", () => {
    for (const provider of Object.values(PROVIDERS)) {
      for (const col of provider.schema.writableColumns) {
        expect(isProtectedColumn(col)).toBe(false);
      }
    }
    for (const col of getAllWritableColumns()) {
      expect(isProtectedColumn(col)).toBe(false);
    }
  });

  it("leaves editorial columns writable", () => {
    for (const col of ["title", "body_html", "seo_title", "price", "status"]) {
      expect(isProtectedColumn(col)).toBe(false);
    }
  });
});

describe("protectedColumnRefusal", () => {
  it("states the block is permanent and carries the reason", () => {
    const msg = protectedColumnRefusal("barcode");
    expect(msg).toContain("BLOCKED");
    expect(msg).toContain("barcode");
    expect(msg).toContain("globally registered");
    expect(msg).toContain("do not retry");
  });

  it("steers SEO requests away from handle toward seo fields", () => {
    const msg = protectedColumnRefusal("handle");
    expect(msg).toContain("BLOCKED");
    expect(msg).toContain("handle");
    expect(msg).toContain("seo_title");
    expect(msg).toContain("seo_description");
    expect(msg).toContain("do not retry");
  });
});

describe("stripProtectedColumns", () => {
  it("drops protected keys from a generated row and reports them", () => {
    const { row, stripped } = stripProtectedColumns({
      title: "Galaxy Pulse X1 Pro",
      handle: "galaxy-pulse-x1-pro",
      primary_sku: "GPX1-PRO-001",
      barcode: "0123456789012",
      inventory_total: 42,
    });

    expect(row).toEqual({ title: "Galaxy Pulse X1 Pro" });
    expect(stripped.sort()).toEqual([
      "barcode",
      "handle",
      "inventory_total",
      "primary_sku",
    ]);
  });

  it("passes clean rows through untouched", () => {
    const { row, stripped } = stripProtectedColumns({ title: "A", vendor: "B" });
    expect(row).toEqual({ title: "A", vendor: "B" });
    expect(stripped).toEqual([]);
  });
});
