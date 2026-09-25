import { afterEach, describe, expect, it, vi } from "vitest";
import { extractIdentifiers, lookupStoreCatalog, storeDomainsToQuery } from "./store-lookup";

describe("extractIdentifiers", () => {
  it("keeps codes and barcodes, skips prices, quantities and phrases", () => {
    expect(
      extractIdentifiers({
        Code: "RCP1151426",
        Description: "2.4G RC ENGINEERING VEHICLE (YELLOW)",
        "Selling Price TTC": "299.99",
        Brand: "PAKTAT",
        Qty: "16",
        Barcode: "3000000071502",
        Model: "WX-100",
      })
    ).toEqual(["RCP1151426", "3000000071502", "WX-100"]);
  });

  it("dedupes case-insensitively", () => {
    expect(extractIdentifiers({ a: "ABC123", b: "abc123" })).toEqual(["ABC123"]);
  });
});

describe("storeDomainsToQuery", () => {
  it("uses allowed websites plus ones named in the custom instruction, never blocked ones", () => {
    expect(
      storeDomainsToQuery({
        allowedDomains: ["toys4less.com"],
        blockedDomains: ["amazon.com"],
        customInstruction: "Prefer https://www.paktattoys.com/ or amazon.com listings. Front view first.",
      })
    ).toEqual(["toys4less.com", "paktattoys.com"]);
  });
});

describe("lookupStoreCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStore(products: Record<string, unknown>) {
    const fetchMock = vi.fn((input: string) => {
      if (input.startsWith("https://shop.test/search/suggest.json")) {
        return Promise.resolve(
          Response.json({
            resources: { results: { products: Object.keys(products).map((handle) => ({ handle })) } },
          })
        );
      }
      const handle = input.match(/\/products\/([^/]+)\.json$/)?.[1];
      if (handle && products[handle]) return Promise.resolve(Response.json({ product: products[handle] }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns only products whose SKU or barcode exactly matches the row", async () => {
    stubStore({
      "boxing-gear": {
        title: "Boxing Gear",
        variants: [{ sku: "SSP9999999", barcode: "" }],
        images: [{ src: "https://cdn.shopify.com/wrong.jpg" }],
      },
      "boxing-gear-1": {
        title: "Boxing Gear",
        vendor: "Paktat",
        variants: [{ sku: "SSP1505888", barcode: "3000000048405" }],
        images: [{ src: "https://cdn.shopify.com/a.jpg" }, { src: "https://cdn.shopify.com/b.jpg" }],
      },
    });
    const matches = await lookupStoreCatalog({
      rowData: { Code: "ssp1505888", Description: "BOXING SET" },
      allowedDomains: ["shop.test"],
      blockedDomains: [],
    });
    expect(matches).toEqual([
      {
        pageUrl: "https://shop.test/products/boxing-gear-1",
        title: "Boxing Gear",
        vendor: "Paktat",
        skus: ["SSP1505888"],
        barcodes: ["3000000048405"],
        imageUrls: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"],
      },
    ]);
  });

  it("does nothing without a store to query or an identifier to search", async () => {
    const fetchMock = stubStore({});
    expect(
      await lookupStoreCatalog({ rowData: { Code: "ABC12345" }, allowedDomains: [], blockedDomains: [] })
    ).toEqual([]);
    expect(
      await lookupStoreCatalog({ rowData: { Title: "Red chair" }, allowedDomains: ["shop.test"], blockedDomains: [] })
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns nothing when the store is not Shopify or fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<html></html>", { headers: { "content-type": "text/html" } })))
    );
    expect(
      await lookupStoreCatalog({ rowData: { Code: "ABC12345" }, allowedDomains: ["shop.test"], blockedDomains: [] })
    ).toEqual([]);
  });
});
