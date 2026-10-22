import { describe, expect, it } from "vitest";
import { buildPlatformCsv, IMAGE_EXPORT_PLATFORMS } from "./index";
import { parseCsv } from "./csv-test-utils";
import type { PlatformCsvInput } from "./common";

type Row = Record<string, string>;

const links = (value: string) => value.split("\n").filter(Boolean);

function input(rows: Row[], mapping: Record<string, string>): PlatformCsvInput<Row> {
  return {
    products: rows.map((row) => [row]),
    mapping,
    text: (row, key) => row[key] ?? "",
    images: (row, key) => links(row[key] ?? ""),
  };
}

const rows: Row[] = [
  { Handle: "bag", SKU: "B1", Name: "Bag", Main: "https://s/main.jpg", Gallery: "https://s/g1.jpg\nhttp://s/old.jpg\nhttps://s/g2.jpg" },
  { Handle: "", SKU: "", Name: "No id", Main: "https://s/x.jpg", Gallery: "https://s/y.jpg" },
];

describe("image modes", () => {
  it("are offered first for image tools, with the gallery columns guessed", () => {
    const shopify = IMAGE_EXPORT_PLATFORMS.find((p) => p.id === "shopify")!;
    expect(shopify.modes?.map((m) => m.id)).toEqual(["images", "products"]);
    expect(
      shopify.modes![0].guessMapping([
        { key: "Product Image URL", label: "Product Image URL" },
        { key: "Gallery Images", label: "Gallery Images" },
        { key: "Handle", label: "Handle" },
        { key: "Title", label: "Title" },
      ])
    ).toEqual({ "URL handle": "Handle", Title: "Title", main_image: "Product Image URL", new_images: "Gallery Images" });
  });

  it("Shopify writes only title, handle and pictures, main picture first", async () => {
    const csv = await buildPlatformCsv(
      "shopify",
      input(rows, { "URL handle": "Handle", Title: "Name", main_image: "Main", new_images: "Gallery" }),
      "images"
    );
    expect(csv.split("\n")[0]).toBe("Title,URL handle,Product image URL,Image position,Image alt text");
    expect(parseCsv(csv).map((r) => [r.Title, r["URL handle"], r["Product image URL"], r["Image position"]])).toEqual([
      ["Bag", "bag", "https://s/main.jpg", "1"],
      ["", "bag", "https://s/g1.jpg", "2"],
      ["", "bag", "https://s/g2.jpg", "3"],
    ]);
  });

  it("WooCommerce lists every picture in one cell, main first", async () => {
    const csv = await buildPlatformCsv("woocommerce", input(rows, { SKU: "SKU", main_image: "Main", new_images: "Gallery" }), "images");
    expect(parseCsv(csv)).toEqual([{ SKU: "B1", Images: "https://s/main.jpg, https://s/g1.jpg, https://s/g2.jpg" }]);
  });

  it("Magento adds only the new pictures as additional images", async () => {
    const csv = await buildPlatformCsv("magento", input(rows, { sku: "SKU", new_images: "Gallery", image_label: "Name" }), "images");
    expect(parseCsv(csv)).toEqual([
      { sku: "B1", additional_images: "https://s/g1.jpg,https://s/g2.jpg", additional_image_labels: "Bag,Bag" },
    ]);
  });
});
