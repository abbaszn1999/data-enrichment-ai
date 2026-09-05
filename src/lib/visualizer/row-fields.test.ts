import { describe, expect, it } from "vitest";
import {
  mappedProductFields,
  validateVisualizerSettings,
  visualizerImageColumnOptions,
} from "@/lib/visualizer/row-fields";
import { DEFAULT_VISUALIZER_SETTINGS } from "@/lib/visualizer/types";

const rows = [
  {
    originalData: {
      Title: "Sony WH-1000XM5",
      "Body (HTML)": "<p>Headphones</p>",
      "Image Src": "https://cdn.shopify.com/s/files/1/product.jpg",
      Vendor: "Sony",
    },
  },
  {
    originalData: {
      Title: "AirPods Pro",
      "Body (HTML)": "<p>Earbuds</p>",
      "Image Src": "https://cdn.shopify.com/s/files/1/airpods.jpg",
      Vendor: "Apple",
    },
  },
];

describe("visualizerImageColumnOptions", () => {
  it("lists URL columns regardless of header name", () => {
    expect(
      visualizerImageColumnOptions({
        columns: ["Title", "Body (HTML)", "Image Src", "Vendor"],
        rows,
      })
    ).toEqual(["Image Src"]);
  });

  it("keeps a previously saved column visible even if the sample is sparse", () => {
    expect(
      visualizerImageColumnOptions({
        columns: ["Title", "Image Src"],
        rows,
        selected: "Title",
      })
    ).toEqual(["Title", "Image Src"]);
  });
});

describe("validateVisualizerSettings image column", () => {
  const settings = {
    ...DEFAULT_VISUALIZER_SETTINGS,
    selectedColumns: ["Title"],
  };

  it("rejects a text column even when its name exists on the sheet", () => {
    expect(
      validateVisualizerSettings(
        { ...settings, productImageColumn: "Title" },
        ["Title", "Image Src"],
        rows
      )
    ).toMatch(/image URLs/i);
  });

  it("accepts any header whose cells are http URLs", () => {
    expect(
      validateVisualizerSettings(
        { ...settings, productImageColumn: "Image Src" },
        ["Title", "Image Src"],
        rows
      )
    ).toBeNull();
  });
});

describe("mappedProductFields", () => {
  it("uses the first parsed URL from the image column, not raw title text", () => {
    const product = mappedProductFields(
      {
        id: "1",
        rowIndex: 0,
        status: "not_started",
        originalData: rows[0]!.originalData,
        imagePlaceholders: [],
      },
      { selectedColumns: ["Title"], productImageColumn: "Image Src" }
    );
    expect(product.productImage).toBe(
      "https://cdn.shopify.com/s/files/1/product.jpg"
    );
    expect(
      mappedProductFields(
        {
          id: "1",
          rowIndex: 0,
          status: "not_started",
          originalData: rows[0]!.originalData,
          imagePlaceholders: [],
        },
        { selectedColumns: ["Title"], productImageColumn: "Title" }
      ).productImage
    ).toBeUndefined();
  });
});
