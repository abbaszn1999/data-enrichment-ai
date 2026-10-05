import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENRICHMENT_COLUMNS,
  SOURCE_URLS_COLUMN_ID,
  ensureSourceUrlsColumn,
  getDefaultEnrichmentColumns,
  isProductModeColumn,
} from "./index";

describe("Source URLs default column", () => {
  it("starts hidden like Image URLs, and is not part of the Enrichment list", () => {
    expect(getDefaultEnrichmentColumns("product").filter((c) => c.enabled).map((c) => c.id)).toEqual([]);
    expect(isProductModeColumn(SOURCE_URLS_COLUMN_ID, "product")).toBe(true);
  });

  it("stays in the list for PLP sheets, which keep their own Source URLs flow", () => {
    expect(isProductModeColumn(SOURCE_URLS_COLUMN_ID, "plp")).toBe(false);
  });

  it("keeps all five defaults, each with an editable starting instruction", () => {
    const five = DEFAULT_ENRICHMENT_COLUMNS.slice(0, 5);
    expect(five.map((c) => c.id)).toEqual([
      "titleTag",
      "marketingDescription",
      "productSpecifications",
      "faq",
      "sourceUrls",
    ]);
    for (const col of five) expect(col.customInstruction?.trim().length, col.id).toBeGreaterThan(20);
  });

  it("is a different column from Image sources and Lens founds, which share its type", () => {
    const sources = DEFAULT_ENRICHMENT_COLUMNS.filter((c) => c.type === "sourceUrls").map((c) => c.id);
    expect(sources).toEqual(["sourceUrls", "imageSourceUrls", "lensFounds"]);
  });

  it("leaves PLP defaults alone", () => {
    expect(getDefaultEnrichmentColumns("plp").find((c) => c.id === "sourceUrls")?.enabled).toBe(false);
  });
});

describe("ensureSourceUrlsColumn", () => {
  const withoutSourceUrls = DEFAULT_ENRICHMENT_COLUMNS.filter((c) => c.id !== SOURCE_URLS_COLUMN_ID);

  it("adds the column, switched off, right after FAQ for sessions saved without it", () => {
    const migrated = ensureSourceUrlsColumn(withoutSourceUrls, "product");
    const ids = migrated.map((c) => c.id);
    expect(ids.indexOf("sourceUrls")).toBe(ids.indexOf("faq") + 1);
    expect(migrated.find((c) => c.id === "sourceUrls")?.enabled).toBe(false);
  });

  it("does nothing when the column is already there, for PLP, or when the user moved things", () => {
    expect(ensureSourceUrlsColumn(DEFAULT_ENRICHMENT_COLUMNS, "product")).toBe(DEFAULT_ENRICHMENT_COLUMNS);
    expect(ensureSourceUrlsColumn(withoutSourceUrls, "plp")).toBe(withoutSourceUrls);
  });

  it("falls back to before Categories, then to the end", () => {
    const noFaq = withoutSourceUrls.filter((c) => c.id !== "faq");
    const beforeCategories = ensureSourceUrlsColumn(noFaq, "product").map((c) => c.id);
    expect(beforeCategories.indexOf("sourceUrls")).toBe(beforeCategories.indexOf("categories") - 1);
    const custom = [withoutSourceUrls[0]!];
    expect(ensureSourceUrlsColumn(custom, "product").at(-1)?.id).toBe("sourceUrls");
  });
});
