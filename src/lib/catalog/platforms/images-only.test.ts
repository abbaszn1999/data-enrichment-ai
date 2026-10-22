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

  it("Shopify writes title, handle, Default Title option and pictures, main picture first", async () => {
    const csv = await buildPlatformCsv(
      "shopify",
      input(rows, { "URL handle": "Handle", Title: "Name", main_image: "Main", new_images: "Gallery" }),
      "images"
    );
    expect(csv.split("\n")[0]).toBe(
      "Title,URL handle,Option1 name,Option1 value,Product image URL,Image position,Image alt text"
    );
    expect(
      parseCsv(csv).map((r) => [r.Title, r["URL handle"], r["Option1 name"], r["Option1 value"], r["Product image URL"], r["Image position"]])
    ).toEqual([
      ["Bag", "bag", "Title", "Default Title", "https://s/main.jpg", "1"],
      ["", "bag", "", "", "https://s/g1.jpg", "2"],
      ["", "bag", "", "", "https://s/g2.jpg", "3"],
    ]);
  });

  it("Shopify turns a title in the handle column into a handle and keeps a mapped option", async () => {
    const csv = await buildPlatformCsv(
      "shopify",
      {
        ...input([{ H: "Men's L-Spin Evo - 49SMA", T: "Shoe", Size: "40", G: "https://s/a.jpg" }], {
          "URL handle": "H",
          Title: "T",
          new_images: "G",
          "Option1 value": "Size",
        }),
        optionName: "Size",
      },
      "images"
    );
    expect(parseCsv(csv)[0]).toMatchObject({ "URL handle": "men-s-l-spin-evo-49sma", "Option1 name": "Size", "Option1 value": "40" });
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
