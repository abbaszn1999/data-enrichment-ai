import { describe, expect, it } from "vitest";
import { catalogRowStoreEnabled, galleryRowStoreEnabled, visualizerRowStoreEnabled } from "./flag";
import {
  projectRowToRecord,
  recordToProjectRow,
  shouldRecomputeMatchTypes,
} from "./session-rows";

describe("catalog session row store", () => {
  it("enables unless CATALOG_ROW_STORE=0", () => {
    const previous = process.env.CATALOG_ROW_STORE;
    delete process.env.CATALOG_ROW_STORE;
    expect(catalogRowStoreEnabled()).toBe(true);
    process.env.CATALOG_ROW_STORE = "0";
    expect(catalogRowStoreEnabled()).toBe(false);
    if (previous === undefined) delete process.env.CATALOG_ROW_STORE;
    else process.env.CATALOG_ROW_STORE = previous;
  });

  it("enables gallery and visualizer stores unless set to 0", () => {
    const prevG = process.env.GALLERY_ROW_STORE;
    const prevV = process.env.VISUALIZER_ROW_STORE;
    delete process.env.GALLERY_ROW_STORE;
    delete process.env.VISUALIZER_ROW_STORE;
    expect(galleryRowStoreEnabled()).toBe(true);
    expect(visualizerRowStoreEnabled()).toBe(true);
    process.env.GALLERY_ROW_STORE = "0";
    process.env.VISUALIZER_ROW_STORE = "0";
    expect(galleryRowStoreEnabled()).toBe(false);
    expect(visualizerRowStoreEnabled()).toBe(false);
    if (prevG === undefined) delete process.env.GALLERY_ROW_STORE;
    else process.env.GALLERY_ROW_STORE = prevG;
    if (prevV === undefined) delete process.env.VISUALIZER_ROW_STORE;
    else process.env.VISUALIZER_ROW_STORE = prevV;
  });

  it("round-trips a session row", () => {
    const row = {
      id: "r1",
      rowIndex: 3,
      status: "done" as const,
      originalData: { sku: "A" },
      enrichedData: { title: "Hat" },
      matchType: "existing" as const,
    };
    expect(recordToProjectRow(projectRowToRecord("sess", row))).toEqual(
      expect.objectContaining(row)
    );
  });

  it("does not recompute match types once they were persisted", () => {
    expect(
      shouldRecomputeMatchTypes(
        {
          matchingSkipped: false,
          rows: [
            {
              id: "1",
              rowIndex: 0,
              status: "pending",
              originalData: {},
              enrichedData: {},
              matchType: "existing",
            },
            {
              id: "2",
              rowIndex: 1,
              status: "pending",
              originalData: {},
              enrichedData: {},
              matchType: "new",
            },
          ],
        },
        "product"
      )
    ).toBe(false);
    expect(
      shouldRecomputeMatchTypes(
        {
          matchingSkipped: false,
          rows: [
            {
              id: "1",
              rowIndex: 0,
              status: "pending",
              originalData: {},
              enrichedData: {},
            },
          ],
        },
        "product"
      )
    ).toBe(true);
    expect(
      shouldRecomputeMatchTypes({ matchingSkipped: true, rows: [] }, "product")
    ).toBe(false);
  });
});
