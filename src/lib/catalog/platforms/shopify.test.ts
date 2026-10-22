import { describe, expect, it } from "vitest";
import { fitLength, slugify, toHtml, toPlainNumber } from "./common";
import { parseCsv as parse } from "./csv-test-utils";
import { SHOPIFY_PLATFORM, buildShopifyCsv } from "./shopify";

type Row = { data: Record<string, string>; images?: string[] };

function build(products: Row[][], mapping: Record<string, string>, optionName?: string) {
  return buildShopifyCsv<Row>({
    products,
    mapping,
    optionName,
    text: (row, key) => row.data[key] ?? "",
    images: (row) => row.images ?? [],
  });
}

describe("Shopify guessMapping", () => {
  it("maps common column names and prefers AI columns", () => {
    const mapping = SHOPIFY_PLATFORM.guessMapping([
      { key: "original:Name", label: "Name" },
      { key: "original:Description", label: "Description" },
      { key: "original:SKU", label: "SKU" },
      { key: "original:Price", label: "Price" },
      { key: "enriched:description", label: "Description" },
      { key: "enriched:imageUrls", label: "Images" },
      { key: "enriched:seoTitle", label: "SEO Title" },
    ]);
    expect(mapping).toMatchObject({
      Title: "original:Name",
      Description: "enriched:description",
      SKU: "original:SKU",
      Price: "original:Price",
      "Product image URL": "enriched:imageUrls",
      "SEO title": "enriched:seoTitle",
    });
  });
});

describe("value cleanup", () => {
  it("formats handles, html, numbers and limits", () => {
    expect(slugify("Men's L-Spin Evo  Sneakers!")).toBe("men-s-l-spin-evo-sneakers");
    expect(toHtml("Line one\nline two\n\nSize < 40 & up")).toBe(
      "<p>Line one<br>line two</p><p>Size &lt; 40 &amp; up</p>"
    );
    expect(toHtml("<p>kept</p>")).toBe("<p>kept</p>");
    expect(toPlainNumber("$1,299.00")).toBe("1299.00");
    expect(toPlainNumber("1.299,50 €")).toBe("1299.50");
    expect(fitLength("one two three four", 12)).toBe("one two");
  });
});

describe("buildShopifyCsv", () => {
  it("uses current headers and Default Title for a single-variant product", async () => {
    const csv = await build(
      [[{ data: { t: "Blue Shirt", p: "$20", c: "" }, images: ["https://a/1.jpg", "http://a/x.jpg", "https://a/2.jpg"] }]],
      { Title: "t", Price: "p", "Option1 value": "c", "Product image URL": "img" },
      "color"
    );
    expect(csv.includes("\r")).toBe(false);
    const rows = parse(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      Title: "Blue Shirt",
      "URL handle": "blue-shirt",
      "Option1 name": "Title",
      "Option1 value": "Default Title",
      Price: "20",
      "Product image URL": "https://a/1.jpg",
      "Image position": "1",
    });
    // http links are dropped: Shopify only downloads https.
    expect(rows[1]).toMatchObject({ "URL handle": "blue-shirt", Title: "", "Product image URL": "https://a/2.jpg", "Image position": "2" });
  });

  it("keeps variants under one handle with option values", async () => {
    const rows = parse(
      await build(
        [[{ data: { t: "Shoe", s: "40", sku: "A-40" } }, { data: { t: "Shoe", s: "41", sku: "A-41" } }]],
        { Title: "t", "Option1 value": "s", SKU: "sku" },
        "Size"
      )
    );
    expect(rows.map((r) => [r["URL handle"], r.Title, r["Option1 name"], r["Option1 value"], r.SKU])).toEqual([
      ["shoe", "Shoe", "Size", "40", "A-40"],
      ["shoe", "", "", "41", "A-41"],
    ]);
  });

  it("turns on inventory tracking with the columns Shopify then requires", async () => {
    const rows = parse(await build([[{ data: { t: "Cap", q: "12.0", w: "1.5" } }]], { Title: "t", "Inventory quantity": "q", "Weight value (grams)": "w" }));
    expect(rows[0]).toMatchObject({
      "Inventory tracker": "shopify",
      "Inventory quantity": "12",
      "Continue selling when out of stock": "deny",
      "Fulfillment service": "manual",
      "Weight value (grams)": "2",
    });
  });

  it("leaves unmapped fields out and de-duplicates handles", async () => {
    const csv = await build([[{ data: { t: "Cap" } }], [{ data: { t: "Cap" } }]], { Title: "t" });
    expect(csv.split("\n")[0]).toBe("Title,URL handle,Option1 name,Option1 value");
    expect(parse(csv).map((r) => r["URL handle"])).toEqual(["cap", "cap-2"]);
  });
});
