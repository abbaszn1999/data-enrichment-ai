import { describe, expect, it } from "vitest";
import { wooRecordsToCsv } from "../../src/store-agent/woocommerce/export";
import { inspectWooRequest, normalizeWooPath } from "../../src/store-agent/woocommerce/guard";
import { parseTargetKey, wooBatchErrors, wooRestoreRequests } from "../../src/store-agent/woocommerce/snapshot";
import type { Snapshot } from "../../src/store-agent/shopify/snapshot";

describe("WooCommerce guard", () => {
  it("normalizes paths and rejects anything that is not a plain wc/v3 route", () => {
    expect(normalizeWooPath("/wp-json/wc/v3/products/12/")).toBe("products/12");
    expect(normalizeWooPath("wc/v3/products/categories")).toBe("products/categories");
    expect(normalizeWooPath("https://evil.example/wp-json/wc/v3/products")).toBeNull();
    expect(normalizeWooPath("products?status=draft")).toBeNull();
    expect(normalizeWooPath("products/../orders")).toBeNull();
    expect(normalizeWooPath("products\\12")).toBeNull();
  });

  it("refuses everything outside the catalogue", () => {
    for (const [method, path] of [
      ["GET", "orders"],
      ["GET", "customers/5"],
      ["POST", "coupons"],
      ["GET", "products/reviews"],
      ["POST", "webhooks"],
      ["GET", "settings/general"],
      ["GET", "system_status"],
      ["GET", "reports/sales"],
      ["POST", "payment_gateways/stripe"],
      ["GET", "../wp/v2/users"],
      ["GET", "/wp-json/wp/v2/users"],
      ["POST", "products/shipping_classes"],
      ["DELETE", "variations"],
    ] as const) {
      const verdict = inspectWooRequest(method, path, {});
      expect(verdict.ok, `${method} ${path}`).toBe(false);
    }
  });

  it("classifies catalogue requests and collects what they touch", () => {
    const read = inspectWooRequest("GET", "products", undefined, { per_page: 100 });
    expect(read).toMatchObject({ ok: true, risk: "read" });

    const update = inspectWooRequest("PUT", "products/12", { regular_price: "9.90" });
    expect(update).toMatchObject({ ok: true, risk: "write", operation: "product.update", records: 1 });
    if (update.ok) expect([...update.targets.keys()]).toEqual(["product:12"]);

    const variation = inspectWooRequest("POST", "products/12/variations/34", { sale_price: "" });
    expect(variation).toMatchObject({ ok: true, risk: "write", operation: "variation.update" });
    if (variation.ok) expect(variation.targets.get("variation:12/34")?.fields).toEqual({ sale_price: "" });

    const term = inspectWooRequest("PUT", "products/attributes/1/terms/7", { name: "Red" });
    if (term.ok) expect([...term.targets.keys()]).toEqual(["attribute_term:1/7"]);

    expect(inspectWooRequest("POST", "products", { name: "New" })).toMatchObject({ ok: true, operation: "product.create", risk: "write" });
    expect(inspectWooRequest("POST", "products/12/variations/generate", {})).toMatchObject({ ok: true, operation: "variation.generate" });
  });

  it("knows which deletes skip the Trash", () => {
    expect(inspectWooRequest("DELETE", "products/12", undefined)).toMatchObject({ risk: "delete", operation: "product.trash", permanent: false });
    expect(inspectWooRequest("DELETE", "products/12", undefined, { force: true })).toMatchObject({ operation: "product.delete", permanent: true });
    expect(inspectWooRequest("DELETE", "products/categories/3", undefined)).toMatchObject({ risk: "delete", permanent: true });
    expect(inspectWooRequest("POST", "products/batch", { delete: [1, 2] })).toMatchObject({ risk: "delete", permanent: true, records: 2 });
  });

  it("checks batch bodies", () => {
    const batch = inspectWooRequest("POST", "products/batch", { update: [{ id: 1, status: "draft" }, { id: 2, status: "draft" }], create: [{ name: "A" }] });
    expect(batch).toMatchObject({ ok: true, risk: "write", records: 3 });
    if (batch.ok) expect([...batch.targets.keys()]).toEqual(["product:1", "product:2"]);
    expect(inspectWooRequest("POST", "products/batch", {}).ok).toBe(false);
    expect(inspectWooRequest("POST", "products/batch", { update: [{ status: "draft" }] }).ok).toBe(false);
    expect(inspectWooRequest("POST", "products/batch", { update: Array.from({ length: 101 }, (_, i) => ({ id: i + 1 })) }).ok).toBe(false);
  });
});

describe("WooCommerce undo", () => {
  const record = (id: string, before: Record<string, unknown>): Snapshot => ({ id, type: id.split(":")[0]!, label: id, before, after: {}, unsupported: [] });

  it("parses target keys", () => {
    expect(parseTargetKey("variation:12/34")).toEqual({ type: "variation", parent: 12, id: 34 });
    expect(parseTargetKey("product:5")).toEqual({ type: "product", parent: undefined, id: 5 });
    expect(parseTargetKey("order:5")).toBeNull();
  });

  it("puts saved values back with batch updates per route, 50 at a time", () => {
    const records = [
      ...Array.from({ length: 60 }, (_, i) => record(`product:${i + 1}`, { regular_price: "10" })),
      record("variation:7/70", { sale_price: "" }),
      record("variation:8/80", { sale_price: "5" }),
      record("category:3", { name: "Shoes" }),
      record("product:999", {}),
    ];
    const requests = wooRestoreRequests(records);
    expect(requests.map((r) => [r.path, r.body.update.length])).toEqual([
      ["products/batch", 50],
      ["products/batch", 10],
      ["products/7/variations/batch", 1],
      ["products/8/variations/batch", 1],
      ["products/categories/batch", 1],
    ]);
    expect(requests[2]!.body.update[0]).toEqual({ id: 70, sale_price: "" });
  });

  it("reads per-item errors from a batch response", () => {
    expect(
      wooBatchErrors({ update: [{ id: 1, name: "ok" }, { id: 2, error: { code: "x", message: "Invalid <b>ID</b>." } }], delete: [] })
    ).toEqual([{ id: 2, message: "Invalid ID." }]);
  });
});

describe("WooCommerce export CSV", () => {
  it("flattens lists and drops links", () => {
    const { csv, columns } = wooRecordsToCsv([
      {
        id: 1,
        name: 'Bag "XL"',
        sku: "B1",
        categories: [{ id: 3, name: "Bags" }, { id: 4, name: "Women" }],
        images: [{ id: 9, src: "https://x/1.jpg" }],
        attributes: [{ name: "Color", options: ["Red", "Blue"] }],
        dimensions: { length: "10", width: "", height: "5" },
        _links: { self: [] },
      },
    ]);
    expect(columns.slice(0, 3)).toEqual(["id", "name", "sku"]);
    expect(columns).not.toContain("_links");
    expect(csv).toContain('"Bag ""XL"""');
    expect(csv).toContain("Bags | Women");
    expect(csv).toContain("Color: Red/Blue");
    expect(csv).toContain("10x-x5");
  });
});
