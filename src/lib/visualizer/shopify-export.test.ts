import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { VisualizerRow } from "@/lib/visualizer/types";
import { buildShopifyFilesZip, shopifyFileName, shopifyFilesLinks } from "./shopify-export";

const rows = [
  { id: "r1", imagePlaceholders: [{ index: 1, storagePath: "ws/description-visualizer/s/rows/r1/1.png" }] },
  { id: "r2", imagePlaceholders: [{ index: 1, storagePath: "ws/description-visualizer/s/rows/r2/1.jpg" }] },
] as unknown as VisualizerRow[];

describe("Shopify Files export", () => {
  it("names each picture from its path, so the name is stable and unique", () => {
    const name = shopifyFileName("ws/a/1.png");
    expect(name).toMatch(/^vz-[0-9a-f]{20}\.png$/);
    expect(shopifyFileName("ws/a/1.png")).toBe(name);
    expect(shopifyFileName("ws/b/1.png")).not.toBe(name);
  });

  it("points every description picture at the store's Files folder", () => {
    const links = shopifyFilesLinks(rows, "https://cdn.shopify.com/s/files/1/2/files/");
    expect(links["ws/description-visualizer/s/rows/r1/1.png"]).toBe(
      `https://cdn.shopify.com/s/files/1/2/files/${shopifyFileName("ws/description-visualizer/s/rows/r1/1.png")}`
    );
  });

  it("zips the CSV, the steps and each picture under that name", async () => {
    const admin = {
      storage: { from: () => ({ download: async () => ({ data: new Blob(["img"]) }) }) },
    } as unknown as Parameters<typeof buildShopifyFilesZip>[0]["admin"];
    const zip = await JSZip.loadAsync(await buildShopifyFilesZip({ admin, rows, csv: "Title\nBag" }));
    expect(Object.keys(zip.files).sort()).toEqual(
      [
        "README.txt",
        "images/",
        `images/${shopifyFileName("ws/description-visualizer/s/rows/r1/1.png")}`,
        `images/${shopifyFileName("ws/description-visualizer/s/rows/r2/1.jpg")}`,
        "shopify-products.csv",
      ].sort()
    );
    expect(await zip.file("shopify-products.csv")!.async("string")).toBe("Title\nBag");
  });
});
