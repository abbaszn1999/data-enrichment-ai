import { describe, expect, it } from "vitest";
import {
  buildShopifyCsv,
  guessShopifyMapping,
  shopifyHandle,
  toShopifyHtml,
  toShopifyNumber,
} from "./shopify";

type Row = { data: Record<string, string>; images?: string[] };

function parse(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.split("\r\n").map((line) =>
    [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'))
  );
  return lines.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])));
}

function build(products: Row[][], mapping: Record<string, string>, optionName?: string) {
  return buildShopifyCsv<Row>({
    products,
    mapping,
    optionName,
    text: (row, key) => row.data[key] ?? "",
    images: (row) => row.images ?? [],
  });
}

describe("guessShopifyMapping", () => {
  it("maps common column names and prefers AI columns", () => {
    const mapping = guessShopifyMapping([
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
      "Body (HTML)": "enriched:description",
      "Variant SKU": "original:SKU",
      "Variant Price": "original:Price",
      "Image Src": "enriched:imageUrls",
      "SEO Title": "enriched:seoTitle",
    });
  });
});

describe("value cleanup", () => {
  it("formats handles, html and numbers", () => {
    expect(shopifyHandle("Men's L-Spin Evo  Sneakers!")).toBe("men-s-l-spin-evo-sneakers");
    expect(toShopifyHtml("Line one\nline two\n\nSize < 40 & up")).toBe(
      "<p>Line one<br>line two</p><p>Size &lt; 40 &amp; up</p>"
    );
    expect(toShopifyHtml("<p>kept</p>")).toBe("<p>kept</p>");
    expect(toShopifyNumber("$1,299.00")).toBe("1299.00");
    expect(toShopifyNumber("1.299,50 €")).toBe("1299.50");
  });
});

describe("buildShopifyCsv", () => {
  it("writes one line per image for a single-variant product", async () => {
    const rows = parse(
      await build(
        [[{ data: { t: "Blue Shirt", p: "20" }, images: ["https://a/1.jpg", "https://a/2.jpg"] }]],
        { Title: "t", "Variant Price": "p", "Image Src": "img" }
      )
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      Handle: "blue-shirt",
      Title: "Blue Shirt",
      "Option1 Name": "Title",
      "Option1 Value": "Default Title",
      "Variant Price": "20",
      "Image Src": "https://a/1.jpg",
      "Image Position": "1",
    });
    expect(rows[1]).toMatchObject({ Handle: "blue-shirt", Title: "", "Image Src": "https://a/2.jpg", "Image Position": "2" });
  });

  it("keeps variants under one handle with option values", async () => {
    const rows = parse(
      await build(
        [[{ data: { t: "Shoe", s: "40", sku: "A-40" } }, { data: { t: "Shoe", s: "41", sku: "A-41" } }]],
        { Title: "t", "Option1 Value": "s", "Variant SKU": "sku" },
        "Size"
      )
    );
    expect(rows.map((r) => [r.Handle, r.Title, r["Option1 Name"], r["Option1 Value"], r["Variant SKU"]])).toEqual([
      ["shoe", "Shoe", "Size", "40", "A-40"],
      ["shoe", "", "", "41", "A-41"],
    ]);
  });

  it("leaves unmapped fields out and de-duplicates handles", async () => {
    const csv = await build([[{ data: { t: "Cap" } }], [{ data: { t: "Cap" } }]], { Title: "t" });
    expect(csv.split("\r\n")[0]).toBe('"Handle","Title","Option1 Name","Option1 Value"');
    expect(parse(csv).map((r) => r.Handle)).toEqual(["cap", "cap-2"]);
  });
});
