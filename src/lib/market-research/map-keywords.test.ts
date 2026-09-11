import { describe, expect, it } from "vitest";
import { keywordSampleNeedsRebuild } from "./map-keywords";
import { datasetPageExhausted } from "./providers/apify-keyword-ideas";

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

describe("datasetPageExhausted", () => {
  it("does not treat a short Apify page as the end of the dataset", () => {
    expect(datasetPageExhausted(13)).toBe(false);
    expect(datasetPageExhausted(250)).toBe(false);
  });

  it("only stops when a page returns no items", () => {
    expect(datasetPageExhausted(0)).toBe(true);
  });
});
