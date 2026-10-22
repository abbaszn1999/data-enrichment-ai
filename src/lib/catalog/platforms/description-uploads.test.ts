import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv-test-utils";
import { uploadedPicturesFolder } from "./description-uploads";
import { buildPlatformCsv, DESCRIPTION_EXPORT_PLATFORMS } from "./index";

type Row = Record<string, string>;
const NAME = "vz-0123456789abcdef0123";

describe("uploadedPicturesFolder", () => {
  it("takes the folder from the link of an uploaded description picture", () => {
    expect(uploadedPicturesFolder(`https://shop.com/wp-content/uploads/2026/10/${NAME}.png`)).toBe(
      "https://shop.com/wp-content/uploads/2026/10/"
    );
    // WordPress may link the -scaled copy; the original stays next to it.
    expect(uploadedPicturesFolder(`https://shop.com/wp-content/uploads/2026/10/${NAME}-scaled.jpg`)).toBe(
      "https://shop.com/wp-content/uploads/2026/10/"
    );
    expect(uploadedPicturesFolder(`https://shop.com/media/wysiwyg/vz/${NAME}.jpg?v=2`)).toBe("https://shop.com/media/wysiwyg/vz/");
  });

  it("refuses links that are not one of the exported pictures", () => {
    expect(uploadedPicturesFolder("https://shop.com/wp-content/uploads/2026/10/photo.png")).toBeNull();
    expect(uploadedPicturesFolder("not a link")).toBeNull();
  });
});

describe("WooCommerce and Magento description exports", () => {
  it("offer the pictures ZIP first, then the description with a pasted link", () => {
    for (const id of ["woocommerce", "magento"]) {
      const platform = DESCRIPTION_EXPORT_PLATFORMS.find((p) => p.id === id)!;
      expect(platform.modes?.map((m) => m.id)).toEqual(["pictures", "description"]);
      expect(platform.modes![0].fields).toEqual([]);
      expect(platform.modes![1].settings?.[0].validate?.("https://x.com/a.png")).toBeTruthy();
    }
  });

  it("guess SKU and the AI description", () => {
    const columns = ["SKU", "Description", "AI Description"].map((key) => ({ key, label: key }));
    const woo = DESCRIPTION_EXPORT_PLATFORMS.find((p) => p.id === "woocommerce")!;
    const magento = DESCRIPTION_EXPORT_PLATFORMS.find((p) => p.id === "magento")!;
    expect(woo.modes![1].guessMapping(columns)).toEqual({ SKU: "SKU", Description: "AI Description" });
    expect(magento.modes![1].guessMapping(columns)).toEqual({ sku: "SKU", Description: "AI Description" });
  });

  const input = (mapping: Record<string, string>) => ({
    products: [[{ S: "B1", D: "<p>Bag</p>" }], [{ S: "", D: "<p>No SKU</p>" }]] as Row[][],
    mapping,
    text: (row: Row, key: string) => row[key] ?? "",
    images: () => [],
  });

  it("WooCommerce writes SKU and Description only", async () => {
    const csv = await buildPlatformCsv("woocommerce", input({ SKU: "S", Description: "D" }), "description");
    expect(parseCsv(csv)).toEqual([{ SKU: "B1", Description: "<p>Bag</p>" }]);
  });

  it("Magento writes sku and description only", async () => {
    const csv = await buildPlatformCsv("magento", input({ sku: "S", Description: "D" }), "description");
    expect(csv.split("\n")[0]).toBe("sku,description");
    expect(parseCsv(csv)).toEqual([{ sku: "B1", description: "<p>Bag</p>" }]);
  });
});
