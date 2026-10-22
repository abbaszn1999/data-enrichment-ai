import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { VisualizerRow } from "@/lib/visualizer/types";
import { SHOPIFY_FILES_README, buildDescriptionPicturesZip, descriptionFileLinks, descriptionFileName } from "./shopify-export";

const rows = [
  { id: "r1", imagePlaceholders: [{ index: 1, storagePath: "ws/description-visualizer/s/rows/r1/1.png" }] },
  { id: "r2", imagePlaceholders: [{ index: 1, storagePath: "ws/description-visualizer/s/rows/r2/1.jpg" }] },
] as unknown as VisualizerRow[];

describe("Shopify Files export", () => {
  it("names each picture from its path, so the name is stable and unique", () => {
    const name = descriptionFileName("ws/a/1.png");
    expect(name).toMatch(/^vz-[0-9a-f]{20}\.png$/);
    expect(descriptionFileName("ws/a/1.png")).toBe(name);
    expect(descriptionFileName("ws/b/1.png")).not.toBe(name);
  });

  it("points every description picture at the store's Files folder", () => {
    const links = descriptionFileLinks(rows, "https://cdn.shopify.com/s/files/1/2/files/");
    expect(links["ws/description-visualizer/s/rows/r1/1.png"]).toBe(
      `https://cdn.shopify.com/s/files/1/2/files/${descriptionFileName("ws/description-visualizer/s/rows/r1/1.png")}`
    );
  });

  it("zips the CSV, the steps and each picture under that name", async () => {
    const admin = {
      storage: { from: () => ({ download: async () => ({ data: new Blob(["img"]) }) }) },
    } as unknown as Parameters<typeof buildDescriptionPicturesZip>[0]["admin"];
    const zip = await JSZip.loadAsync(
      await buildDescriptionPicturesZip({
        admin,
        rows,
        readme: SHOPIFY_FILES_README,
        csv: { name: "shopify-products.csv", content: "Title\nBag" },
      })
    );
    expect(Object.keys(zip.files).sort()).toEqual(
      [
        "README.txt",
        "images/",
        `images/${descriptionFileName("ws/description-visualizer/s/rows/r1/1.png")}`,
        `images/${descriptionFileName("ws/description-visualizer/s/rows/r2/1.jpg")}`,
        "shopify-products.csv",
      ].sort()
    );
    expect(await zip.file("shopify-products.csv")!.async("string")).toBe("Title\nBag");
  });
});
