import { describe, expect, it } from "vitest";
import {
  pendingImageDeleteKey,
  stripPendingImageDeletes,
} from "@/lib/gallery/pending-image-deletes";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";

const sharedUrl = "https://cdn.example/shared-gallery.jpg";

function worksheet(): GalleryWorksheetJson {
  return {
    sessionId: "session-1",
    columns: ["SKU"],
    originalImageColumn: null,
    originalImageSelectionExplicit: true,
    selectedColumns: ["SKU"],
    settings: {
      provider: "scraping",
      scraping: DEFAULT_SCRAPING_SETTINGS,
      ai: DEFAULT_AI_SETTINGS,
    },
    activeRun: null,
    rows: [
      {
        id: "row-a",
        rowIndex: 0,
        status: "ready",
        originalData: { SKU: "A" },
        mainImagePath: null,
        mainImagePaths: [],
        galleryImagePaths: [sharedUrl, "https://cdn.example/a-only.jpg"],
      },
      {
        id: "row-b",
        rowIndex: 1,
        status: "ready",
        originalData: { SKU: "B" },
        mainImagePath: "ws/gallery/s/rows/row-b/main-1.webp",
        mainImagePaths: ["ws/gallery/s/rows/row-b/main-1.webp"],
        galleryImagePaths: [sharedUrl],
      },
    ],
  };
}

describe("stripPendingImageDeletes", () => {
  it("strips a pending gallery URL only from the owning row", () => {
    const pending = new Set([pendingImageDeleteKey("row-a", sharedUrl)]);
    const result = stripPendingImageDeletes(worksheet(), pending);

    expect(result.rows[0]?.galleryImagePaths).toEqual([
      "https://cdn.example/a-only.jpg",
    ]);
    expect(result.rows[1]?.galleryImagePaths).toEqual([sharedUrl]);
    expect(result.rows[1]?.mainImagePaths).toEqual([
      "ws/gallery/s/rows/row-b/main-1.webp",
    ]);
  });

  it("does not strip the same URL from another row when nothing is pending", () => {
    const result = stripPendingImageDeletes(worksheet(), new Set());
    expect(result.rows[0]?.galleryImagePaths).toContain(sharedUrl);
    expect(result.rows[1]?.galleryImagePaths).toContain(sharedUrl);
  });

  it("clears main images only for the owning row", () => {
    const mainPath = "ws/gallery/s/rows/row-b/main-1.webp";
    const pending = new Set([pendingImageDeleteKey("row-b", mainPath)]);
    const result = stripPendingImageDeletes(worksheet(), pending);

    expect(result.rows[1]?.mainImagePaths).toEqual([]);
    expect(result.rows[1]?.mainImagePath).toBeNull();
    expect(result.rows[0]?.galleryImagePaths).toContain(sharedUrl);
  });
});
