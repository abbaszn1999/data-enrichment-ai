import { describe, expect, it } from "vitest";
import {
  estimateScrapingCreditRange,
  shouldChargeGalleryCredits,
} from "@/lib/gallery/pricing";
import { getGalleryRowImagePath } from "@/lib/gallery/storage-paths";
import {
  getGalleryWarning,
  NO_GALLERY_MESSAGE,
} from "@/lib/gallery/agent/process-row";

describe("gallery pipeline invariants", () => {
  it("returns the explicit no-gallery message", () => {
    expect(getGalleryWarning(0, 3)).toBe(NO_GALLERY_MESSAGE);
    expect(getGalleryWarning(2, 3)).toBe("Found 2 of 3 gallery images");
    expect(getGalleryWarning(3, 3)).toBeUndefined();
  });

  it("skips zero-credit deductions", () => {
    expect(shouldChargeGalleryCredits(0)).toBe(false);
    expect(shouldChargeGalleryCredits(-1)).toBe(false);
    expect(shouldChargeGalleryCredits(0.001)).toBe(true);
  });

  it("uses unique final paths for each generated asset", () => {
    const first = getGalleryRowImagePath(
      "workspace",
      "session",
      "row",
      "main",
      "webp"
    );
    const second = getGalleryRowImagePath(
      "workspace",
      "session",
      "row",
      "main",
      "webp"
    );
    expect(first).not.toContain("/tmp/");
    expect(first).not.toBe(second);
  });

  it("estimates separate Main and Gallery agents when no original exists", () => {
    const withoutOriginal = estimateScrapingCreditRange({
      rowCount: 10,
      searchDepth: "medium",
      rowsWithOriginal: 0,
    });
    const withOriginal = estimateScrapingCreditRange({
      rowCount: 10,
      searchDepth: "medium",
      rowsWithOriginal: 10,
    });
    const costlyHistory = estimateScrapingCreditRange({
      rowCount: 10,
      searchDepth: "medium",
      rowsWithOriginal: 10,
      observedMedianQueries: 8,
      observedP90Queries: 30,
    });
    expect(withoutOriginal.max).toBeGreaterThan(withOriginal.max);
    expect(costlyHistory.max).toBeGreaterThan(withOriginal.max);
  });
});
