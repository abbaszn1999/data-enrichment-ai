import { describe, expect, it } from "vitest";
import type { PlatformCsvInput } from "./common";
import { parseCsv } from "./csv-test-utils";
import { MAGENTO_PLATFORM, buildMagentoCsv } from "./magento";
import { WOOCOMMERCE_PLATFORM, buildWooCommerceCsv } from "./woocommerce";

type Row = { data: Record<string, string>; images?: string[] };

function input(products: Row[][], mapping: Record<string, string>, optionName?: string): PlatformCsvInput<Row> {
  return {
    products,
    mapping,
    optionName,
    text: (row, key) => row.data[key] ?? "",
    images: (row) => row.images ?? [],
  };
}

const shirt: Row[][] = [[{ data: { n: "Tee", p: "$10", sku: "T1" }, images: ["https://a/1.jpg", "https://a/2.jpg"] }]];
const shoe: Row[][] = [
  [
    { data: { n: "Shoe", s: "40", sku: "S-40", p: "50", q: "3" }, images: ["https://a/40.jpg"] },
    { data: { n: "Shoe", s: "41", sku: "S-41", p: "55", q: "0" }, images: ["https://a/41.jpg"] },
  ],
];

describe("WooCommerce", () => {
  it("guesses its own field names", () => {
    expect(
      WOOCOMMERCE_PLATFORM.guessMapping([
        { key: "original:Name", label: "Name" },
        { key: "original:Price", label: "Price" },
        { key: "enriched:imageUrls", label: "Images" },
      ])
    ).toMatchObject({ Name: "original:Name", "Regular price": "original:Price", Images: "enriched:imageUrls" });
  });

  it("writes a simple product with comma-separated images", async () => {
    const csv = await buildWooCommerceCsv(input(shirt, { Name: "n", "Regular price": "p", SKU: "sku", Images: "img" }));
    expect(csv.startsWith("\uFEFFType,SKU,Name,Published,Regular price,Images")).toBe(true);
    expect(parseCsv(csv)).toEqual([
      { Type: "simple", SKU: "T1", Name: "Tee", Published: "1", "Regular price": "10", Images: "https://a/1.jpg, https://a/2.jpg" },
    ]);
  });

  it("writes a variable parent and variations linked by SKU", async () => {
    const rows = parseCsv(
      await buildWooCommerceCsv(
        input(shoe, { Name: "n", SKU: "sku", "Regular price": "p", Stock: "q", "Attribute 1 value(s)": "s" }, "Size")
      )
    );
    expect(rows.map((r) => [r.Type, r.SKU, r.Parent, r["Attribute 1 name"], r["Attribute 1 value(s)"], r["Regular price"], r.Stock])).toEqual([
      ["variable", "shoe", "", "Size", "40, 41", "", ""],
      ["variation", "S-40", "shoe", "Size", "40", "50", "3"],
      ["variation", "S-41", "shoe", "Size", "41", "55", "0"],
    ]);
  });
});

describe("Magento", () => {
  it("guesses its own field names", () => {
    expect(
      MAGENTO_PLATFORM.guessMapping([
        { key: "original:Name", label: "Name" },
        { key: "original:SKU", label: "SKU" },
        { key: "enriched:seoTitle", label: "SEO Title" },
      ])
    ).toMatchObject({ name: "original:Name", sku: "original:SKU", meta_title: "enriched:seoTitle" });
  });

  it("writes a simple product with the columns a new product needs", async () => {
    const rows = parseCsv(
      await buildMagentoCsv(input(shirt, { name: "n", price: "p", sku: "sku", images: "img", categories: "c" }))
    );
    expect(rows[0]).toMatchObject({
      sku: "T1",
      attribute_set_code: "Default",
      product_type: "simple",
      product_websites: "base",
      name: "Tee",
      product_online: "1",
      visibility: "Catalog, Search",
      price: "10",
      url_key: "tee",
      base_image: "https://a/1.jpg",
      small_image: "https://a/1.jpg",
      thumbnail_image: "https://a/1.jpg",
      additional_images: "https://a/2.jpg",
    });
  });

  it("puts simple children before their configurable parent", async () => {
    const rows = parseCsv(
      await buildMagentoCsv(input(shoe, { name: "n", sku: "sku", price: "p", qty: "q", configurable_option: "s" }, "Size"))
    );
    expect(rows.map((r) => [r.sku, r.product_type, r.visibility, r.additional_attributes, r.qty, r.is_in_stock])).toEqual([
      ["S-40", "simple", "Not Visible Individually", "size=40", "3", "1"],
      ["S-41", "simple", "Not Visible Individually", "size=41", "0", "0"],
      ["shoe-parent", "configurable", "Catalog, Search", "", "", "1"],
    ]);
    expect(rows[2].configurable_variations).toBe("sku=S-40,size=40|sku=S-41,size=41");
    expect(rows[2].configurable_variation_labels).toBe("size=Size");
  });

  it("adds Default Category in front of category paths", async () => {
    const rows = parseCsv(
      await buildMagentoCsv(input([[{ data: { n: "Bag", p: "5", c: "Gear > Bags\nSale" } }]], { name: "n", price: "p", categories: "c" }))
    );
    expect(rows[0].categories).toBe("Default Category/Gear/Bags,Default Category/Sale");
  });
});
