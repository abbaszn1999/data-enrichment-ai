import { describe, expect, it } from "vitest";
import {
  applyKeywordClassifications,
  keywordClassificationOverlayChanged,
  keywordSampleNeedsRebuild,
  overlayKeywordSampleWithClassified,
} from "./map-keywords";
import { datasetPageExhausted } from "./providers/apify-keyword-expander";

describe("keywordSampleNeedsRebuild", () => {
  it("rebuilds when the archive has more rows than the Extract cache", () => {
    expect(keywordSampleNeedsRebuild(513, 1285)).toBe(true);
    expect(keywordSampleNeedsRebuild(0, 1285)).toBe(true);
  });

  it("leaves a matching or longer cache alone", () => {
    expect(keywordSampleNeedsRebuild(1285, 1285)).toBe(false);
    expect(keywordSampleNeedsRebuild(2000, 1285)).toBe(false);
    expect(keywordSampleNeedsRebuild(0, 0)).toBe(false);
  });
});

describe("overlayKeywordSampleWithClassified", () => {
  const row = (
    keyword: string,
    sheet: "category" | "informational" | "excluded" = "category"
  ) => ({
    id: `row-${keyword}`,
    keyword,
    sheet,
    exclusionReason: undefined as string | undefined,
    plpConcept: sheet === "category" ? "Category PLP" : undefined,
  });

  it("replaces the extract default so informational and excluded verdicts show in Extract", () => {
    const sample = [
      row("how to organize chargers and cables"),
      row("stackwise 160 kit with stack adapters and cables"),
      row("samsung cables and chargers"),
    ];
    const next = overlayKeywordSampleWithClassified(sample, [
      {
        id: "how to organize chargers and cables",
        sheet: "informational",
        reason: "Educational / how-to query",
      },
      {
        keyword: "stackwise 160 kit with stack adapters and cables",
        sheet: "excluded",
        reason: "Single product / SKU (PDP)",
      },
      {
        keyword: "samsung cables and chargers",
        sheet: "category",
        reason: "Brand plus product category",
        plpConcept: "Brand collection",
      },
    ]);
    expect(next.map((r) => r.sheet)).toEqual([
      "informational",
      "excluded",
      "category",
    ]);
    expect(next[0]?.exclusionReason).toContain("how-to");
    expect(next[1]?.exclusionReason).toContain("SKU");
    expect(keywordClassificationOverlayChanged(sample, next)).toBe(true);
  });

  it("matches Gemini log items that put the phrase in id instead of keyword", () => {
    const sample = [row("store cables and adapters")];
    const next = applyKeywordClassifications(sample, [
      {
        id: "store cables and adapters",
        keyword: "",
        sheet: "informational",
        reason: "Ambiguous how-to search",
      },
    ]);
    expect(next[0]?.sheet).toBe("informational");
  });

  it("does not report a change when classified already matches the sample", () => {
    const sample = [row("usb c cables", "category")];
    const next = overlayKeywordSampleWithClassified(sample, [
      { keyword: "usb c cables", sheet: "category", plpConcept: "Category PLP" },
    ]);
    expect(keywordClassificationOverlayChanged(sample, next)).toBe(false);
  });
});

describe("datasetPageExhausted", () => {
  it("does not treat a short Apify page as the end of the dataset", () => {
    expect(datasetPageExhausted(13)).toBe(false);
    expect(datasetPageExhausted(250)).toBe(false);
  });

  it("only stops when a page returns no items", () => {
    expect(datasetPageExhausted(0)).toBe(true);
  });
});
