import { describe, expect, it } from "vitest";
import {
  applyColumnLayout,
  fullColumnOrder,
  isColumnHidden,
  moveColumn,
  reorderKeysInPlace,
  toggleColumnHidden,
} from "./column-layout";

describe("reorderKeysInPlace", () => {
  it("reorders one group inside the slots it already holds, leaving other columns put", () => {
    const keys = ["orig:Code", "enrich:a", "orig:Brand", "enrich:b", "enrich:c"];
    const layout = { order: ["enrich:a", "orig:Code", "enrich:b", "orig:Brand", "enrich:c"], hidden: ["enrich:b"] };
    expect(reorderKeysInPlace(layout, keys, ["enrich:c", "enrich:a", "enrich:b"])).toEqual({
      order: ["enrich:c", "orig:Code", "enrich:a", "orig:Brand", "enrich:b"],
      hidden: ["enrich:b"],
    });
  });

  it("ignores keys the sheet does not have", () => {
    const keys = ["orig:Code", "enrich:a", "enrich:b"];
    expect(reorderKeysInPlace(null, keys, ["enrich:zzz", "enrich:b", "enrich:a"]).order).toEqual([
      "orig:Code",
      "enrich:b",
      "enrich:a",
    ]);
  });
});

const KEYS = ["orig:Code", "orig:Brand", "enrich:enhancedTitle", "enrich:imageUrls"];

describe("applyColumnLayout", () => {
  it("returns natural order when there is no saved layout", () => {
    expect(applyColumnLayout(KEYS, undefined)).toEqual(KEYS);
    expect(applyColumnLayout(KEYS, null)).toEqual(KEYS);
  });

  it("uses the saved order, mixing source and AI columns freely", () => {
    const layout = { order: ["enrich:imageUrls", "orig:Code", "orig:Brand", "enrich:enhancedTitle"], hidden: [] };
    expect(applyColumnLayout(KEYS, layout)).toEqual([
      "enrich:imageUrls",
      "orig:Code",
      "orig:Brand",
      "enrich:enhancedTitle",
    ]);
  });

  it("appends a newly added column (e.g. a fresh AI column) after the saved ones", () => {
    const layout = { order: ["orig:Brand", "orig:Code"], hidden: [] };
    expect(applyColumnLayout(KEYS, layout)).toEqual([
      "orig:Brand",
      "orig:Code",
      "enrich:enhancedTitle",
      "enrich:imageUrls",
    ]);
  });

  it("silently drops a saved key for a column that no longer exists", () => {
    const layout = { order: ["orig:Deleted", "orig:Code", "orig:Brand"], hidden: [] };
    expect(applyColumnLayout(KEYS, layout)).toEqual([
      "orig:Code",
      "orig:Brand",
      "enrich:enhancedTitle",
      "enrich:imageUrls",
    ]);
  });

  it("filters out hidden columns, including hidden AI columns", () => {
    const layout = { order: KEYS, hidden: ["orig:Brand", "enrich:imageUrls"] };
    expect(applyColumnLayout(KEYS, layout)).toEqual(["orig:Code", "enrich:enhancedTitle"]);
  });
});

describe("fullColumnOrder", () => {
  it("includes hidden columns (for the layout panel)", () => {
    const layout = { order: KEYS, hidden: ["orig:Brand"] };
    expect(fullColumnOrder(KEYS, layout)).toEqual(KEYS);
  });
});

describe("moveColumn", () => {
  it("moves a column earlier in the order", () => {
    const result = moveColumn({ order: KEYS, hidden: [] }, KEYS, "enrich:imageUrls", "orig:Code");
    expect(result.order).toEqual(["enrich:imageUrls", "orig:Code", "orig:Brand", "enrich:enhancedTitle"]);
  });

  it("moves a column later in the order (same splice semantics as reorderColumns)", () => {
    const result = moveColumn({ order: KEYS, hidden: [] }, KEYS, "orig:Code", "enrich:imageUrls");
    expect(result.order).toEqual(["orig:Brand", "enrich:enhancedTitle", "enrich:imageUrls", "orig:Code"]);
  });

  it("is a no-op when moving onto itself", () => {
    const result = moveColumn({ order: KEYS, hidden: [] }, KEYS, "orig:Code", "orig:Code");
    expect(result.order).toEqual(KEYS);
  });

  it("preserves hidden state", () => {
    const result = moveColumn({ order: KEYS, hidden: ["orig:Brand"] }, KEYS, "enrich:imageUrls", "orig:Code");
    expect(result.hidden).toEqual(["orig:Brand"]);
  });
});

describe("toggleColumnHidden / isColumnHidden", () => {
  it("hides then shows a column", () => {
    let layout = toggleColumnHidden(undefined, KEYS, "orig:Brand");
    expect(isColumnHidden(layout, "orig:Brand")).toBe(true);
    layout = toggleColumnHidden(layout, KEYS, "orig:Brand");
    expect(isColumnHidden(layout, "orig:Brand")).toBe(false);
  });
});
