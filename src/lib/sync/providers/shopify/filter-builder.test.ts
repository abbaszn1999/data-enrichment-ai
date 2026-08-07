import { describe, expect, it } from "vitest";
import type { SyncSheetRow } from "@/lib/sync/core/types";
import {
  applyClientPredicates,
  bumpImageCountForFeaturedImage,
  effectiveImageCount,
  rowHasImage,
} from "./filter-builder";

function row(partial: Partial<SyncSheetRow>): SyncSheetRow {
  return { ...partial };
}

describe("effectiveImageCount / missing_image", () => {
  it("treats draft featured_image as present even when image_count is 0", () => {
    const r = row({
      title: "StormBook Gaming 15",
      featured_image: "http://cdn.example/a.jpg",
      image_count: 0,
    });
    expect(effectiveImageCount(r)).toBe(1);
    expect(rowHasImage(r)).toBe(true);
    expect(applyClientPredicates([r], [{ kind: "missing_image" }])).toEqual([]);
  });

  it("treats string image_count 0 the same way", () => {
    const r = row({
      featured_image: "https://cdn.example/b.webp",
      image_count: "0",
    });
    expect(rowHasImage(r)).toBe(true);
    expect(applyClientPredicates([r], [{ kind: "missing_image" }])).toEqual([]);
  });

  it("marks truly empty rows as missing images", () => {
    const r = row({ title: "No Pic", featured_image: "", image_count: 0 });
    expect(rowHasImage(r)).toBe(false);
    expect(applyClientPredicates([r], [{ kind: "missing_image" }])).toEqual([0]);
  });

  it("respects store image_count when featured_image is empty", () => {
    const r = row({ featured_image: "", image_count: 3 });
    expect(effectiveImageCount(r)).toBe(3);
    expect(rowHasImage(r)).toBe(true);
    expect(applyClientPredicates([r], [{ kind: "missing_image" }])).toEqual([]);
  });

  it("filters a mixed sheet correctly for missing_image", () => {
    const rows = [
      row({ title: "A", featured_image: "https://x/a.jpg", image_count: 0 }),
      row({ title: "B", featured_image: "", image_count: 0 }),
      row({ title: "C", featured_image: "", image_count: 2 }),
    ];
    expect(applyClientPredicates(rows, [{ kind: "missing_image" }])).toEqual([1]);
  });

  it("image_count_lt uses effective count", () => {
    const rows = [
      row({ featured_image: "https://x/a.jpg", image_count: 0 }),
      row({ featured_image: "", image_count: 0 }),
    ];
    expect(applyClientPredicates(rows, [{ kind: "image_count_lt", n: 1 }])).toEqual([1]);
  });
});

describe("bumpImageCountForFeaturedImage", () => {
  it("sets image_count to 1 when featured_image is present and count is 0", () => {
    const r = row({ featured_image: "https://cdn.example/a.jpg", image_count: 0 });
    bumpImageCountForFeaturedImage(r);
    expect(r.image_count).toBe(1);
  });

  it("does not lower an existing higher image_count", () => {
    const r = row({ featured_image: "https://cdn.example/a.jpg", image_count: 4 });
    bumpImageCountForFeaturedImage(r);
    expect(r.image_count).toBe(4);
  });

  it("no-ops when featured_image is empty", () => {
    const r = row({ featured_image: "", image_count: 0 });
    bumpImageCountForFeaturedImage(r);
    expect(r.image_count).toBe(0);
  });
});
