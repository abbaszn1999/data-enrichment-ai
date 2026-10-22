import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv-test-utils";
import { buildPlatformCsv, DESCRIPTION_EXPORT_PLATFORMS } from "./index";
import { DESCRIPTION_IMAGES_FIELD, shopifyFilesPrefix } from "./shopify-description";

type Row = Record<string, string>;

describe("shopifyFilesPrefix", () => {
  it("takes the store's CDN folder from any picture link", () => {
    expect(shopifyFilesPrefix("https://cdn.shopify.com/s/files/1/0832/7305/6474/files/7283222440_a.jpg?v=1792670292")).toBe(
      "https://cdn.shopify.com/s/files/1/0832/7305/6474/files/"
    );
    expect(shopifyFilesPrefix("https://www.expresstech.ie/cdn/shop/files/phone.png?v=1&width=1536")).toBe(
      "https://www.expresstech.ie/cdn/shop/files/"
    );
    expect(shopifyFilesPrefix("https://example.com/image.jpg")).toBeNull();
    expect(shopifyFilesPrefix("not a link")).toBeNull();
  });
});

describe("Shopify description export", () => {
  it("defaults to updating descriptions and maps the AI description", () => {
    const [shopify] = DESCRIPTION_EXPORT_PLATFORMS;
    expect(shopify.modes?.map((m) => m.id)).toEqual(["description_files", "description", "products"]);
    const columns = ["Handle", "Title", "Description", "AI Description", "Image 1 URL"].map((key) => ({ key, label: key }));
    expect(shopify.modes![1].guessMapping(columns)).toMatchObject({
      "URL handle": "Handle",
      Title: "Title",
      Description: "AI Description",
    });
    expect(shopify.modes![0].guessMapping(columns).Description).toBe("AI Description");
    expect(shopify.modes![2].guessMapping(columns).Description).toBe("AI Description");
  });

  it("writes the description once and one line per picture for Shopify to download", async () => {
    const description = '<p>Hi</p><img src="https://cdn.shopify.com/s/files/1/1/files/vz-abc.png">';
    const csv = await buildPlatformCsv<Row>(
      "shopify",
      {
        products: [[{ H: "Bag", T: "Bag", D: description, P: "https://s/vz-abc.png?token=1\nhttps://s/vz-def.png?token=2" }]],
        mapping: { "URL handle": "H", Title: "T", Description: "D", [DESCRIPTION_IMAGES_FIELD]: "P" },
        text: (row, key) => row[key] ?? "",
        images: (row, key) => (row[key] ?? "").split("\n").filter(Boolean),
      },
      "description"
    );
    expect(parseCsv(csv).map((r) => [r.Title, r["URL handle"], r.Description, r["Option1 value"], r["Product image URL"], r["Image position"]])).toEqual([
      ["Bag", "bag", description, "Default Title", "https://s/vz-abc.png?token=1", "1"],
      ["", "bag", "", "", "https://s/vz-def.png?token=2", "2"],
    ]);
  });

  it("writes no image columns at all when the pictures go to Shopify Files", async () => {
    const csv = await buildPlatformCsv<Row>(
      "shopify",
      {
        products: [[{ H: "Bag", T: "Bag", D: "<p>Hi</p>", P: "https://s/vz-abc.png" }]],
        mapping: { "URL handle": "H", Title: "T", Description: "D", [DESCRIPTION_IMAGES_FIELD]: "P" },
        text: (row, key) => row[key] ?? "",
        images: (row, key) => (row[key] ?? "").split("\n").filter(Boolean),
      },
      "description_files"
    );
    expect(csv.split("\n")[0]).toBe("Title,URL handle,Description,Option1 name,Option1 value");
    expect(parseCsv(csv)).toEqual([
      { Title: "Bag", "URL handle": "bag", Description: "<p>Hi</p>", "Option1 name": "Title", "Option1 value": "Default Title" },
    ]);
  });
});
