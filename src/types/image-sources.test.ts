import { describe, expect, it } from "vitest";
import { isImageFinderRun } from "@/lib/enrich/image-finder/agent";
import {
  DEFAULT_ENRICHMENT_COLUMNS,
  IMAGE_SOURCES_COLUMN_ID,
  catalogModeForRunColumns,
  ensureImageSourcesColumn,
  isProductModeColumn,
} from "./index";

describe("Image sources column", () => {
  it("ships as a disabled sourceUrls-type column right after Image URLs", () => {
    const ids = DEFAULT_ENRICHMENT_COLUMNS.map((col) => col.id);
    expect(ids.indexOf(IMAGE_SOURCES_COLUMN_ID)).toBe(ids.indexOf("imageUrls") + 1);
    const column = DEFAULT_ENRICHMENT_COLUMNS.find((col) => col.id === IMAGE_SOURCES_COLUMN_ID)!;
    expect(column.type).toBe("sourceUrls");
    expect(column.enabled).toBe(false);
    expect(column.label).toBe("Image sources");
  });

  it("is a product-mode column for product sheets only", () => {
    expect(isProductModeColumn(IMAGE_SOURCES_COLUMN_ID, "product")).toBe(true);
    expect(isProductModeColumn(IMAGE_SOURCES_COLUMN_ID, "plp")).toBe(false);
  });

  it("is added to an older session after Image URLs, once", () => {
    const old = DEFAULT_ENRICHMENT_COLUMNS.filter((col) => col.id !== IMAGE_SOURCES_COLUMN_ID);
    const upgraded = ensureImageSourcesColumn(old, "product");
    const ids = upgraded.map((col) => col.id);
    expect(ids.indexOf(IMAGE_SOURCES_COLUMN_ID)).toBe(ids.indexOf("imageUrls") + 1);
    expect(upgraded).toHaveLength(old.length + 1);
    expect(ensureImageSourcesColumn(upgraded, "product")).toBe(upgraded);
  });

  it("leaves PLP sessions and sheets without Image URLs alone", () => {
    const old = DEFAULT_ENRICHMENT_COLUMNS.filter((col) => col.id !== IMAGE_SOURCES_COLUMN_ID);
    expect(ensureImageSourcesColumn(old, "plp")).toBe(old);
    const withoutImages = old.filter((col) => col.id !== "imageUrls");
    expect(ensureImageSourcesColumn(withoutImages, "product")).toBe(withoutImages);
  });

  it("does not change which sidebar mode a run belongs to", () => {
    expect(catalogModeForRunColumns("new", ["imageUrls"])).toBe("images");
    expect(catalogModeForRunColumns("new", ["imageUrls", IMAGE_SOURCES_COLUMN_ID])).toBe("images");
    expect(catalogModeForRunColumns("new", ["imageUrls", "enhancedTitle"])).toBe("enrich");
    expect(catalogModeForRunColumns("new", [IMAGE_SOURCES_COLUMN_ID])).toBe("enrich");
    expect(catalogModeForRunColumns("existing", ["imageUrls"])).toBe("enrich");
  });

  it("puts Source URLs, alone or with Images, in the Source & Image Finder tab", () => {
    expect(catalogModeForRunColumns("new", ["sourceUrls"])).toBe("images");
    expect(catalogModeForRunColumns("new", ["imageUrls", IMAGE_SOURCES_COLUMN_ID, "sourceUrls"])).toBe("images");
    // Next to Enrichment columns it is still an Enrichment-shaped run.
    expect(catalogModeForRunColumns("new", ["sourceUrls", "enhancedTitle"])).toBe("enrich");
    expect(catalogModeForRunColumns("existing", ["sourceUrls"])).toBe("enrich");
  });
});

describe("isImageFinderRun", () => {
  it("is true for Image URLs alone or with Image sources", () => {
    expect(isImageFinderRun("product", ["imageUrls"])).toBe(true);
    expect(isImageFinderRun("product", ["imageUrls", IMAGE_SOURCES_COLUMN_ID])).toBe(true);
  });

  it("stays true when Source URLs is switched on in the same run, but Source URLs alone is not an Image Finder run", () => {
    expect(isImageFinderRun("product", ["imageUrls", IMAGE_SOURCES_COLUMN_ID, "sourceUrls"])).toBe(true);
    expect(isImageFinderRun("product", ["sourceUrls"])).toBe(false);
    expect(isImageFinderRun("product", ["sourceUrls", "enhancedTitle"])).toBe(false);
  });

  it("is false when anything else is enabled, for PLP, and for sources alone", () => {
    expect(isImageFinderRun("product", ["imageUrls", "enhancedTitle"])).toBe(false);
    expect(isImageFinderRun("plp", ["imageUrls"])).toBe(false);
    expect(isImageFinderRun("product", [IMAGE_SOURCES_COLUMN_ID])).toBe(false);
  });
});
