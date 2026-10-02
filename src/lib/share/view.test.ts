import { describe, expect, it } from "vitest";
import {
  buildShareView,
  describeShareView,
  sanitizeShareView,
  shareViewKey,
  viewToColumnFilters,
} from "./view";

describe("share view", () => {
  it("is null for a sheet nobody filtered", () => {
    expect(buildShareView({ columnFilters: {}, search: "", status: "all", activeSheet: "new", sort: null })).toBeNull();
  });

  it("keeps filters, sort, search, status and the Existing tab", () => {
    const view = buildShareView({
      columnFilters: { "orig:Brand": new Set(["Nike", "\u0000(Blanks)"]) },
      sort: { column: "orig:Price", direction: "desc" },
      search: "shoe",
      status: "done",
      activeSheet: "existing",
    });
    expect(view).toEqual({
      columnFilters: { "orig:Brand": ["Nike", "\u0000(Blanks)"] },
      sort: { column: "orig:Price", direction: "desc" },
      search: "shoe",
      status: "done",
      activeSheet: "existing",
    });
  });

  it("round-trips filters back into sets", () => {
    const filters = viewToColumnFilters({ columnFilters: { a: ["x", "y"] } });
    expect([...filters.a]).toEqual(["x", "y"]);
    expect(viewToColumnFilters(null)).toEqual({});
  });

  it("drops unknown keys and bad values from stored data", () => {
    expect(
      sanitizeShareView({
        columnFilters: { a: ["x", 5, null], b: [], c: "nope" },
        sort: { column: "", direction: "asc" },
        status: "weird",
        activeSheet: "other",
        extra: true,
      })
    ).toEqual({ columnFilters: { a: ["x"] } });
    expect(sanitizeShareView("text")).toBeNull();
    expect(sanitizeShareView([])).toBeNull();
  });

  it("caps how many values one column can hold", () => {
    const many = Array.from({ length: 800 }, (_, i) => `v${i}`);
    const view = sanitizeShareView({ columnFilters: { a: many } });
    expect(view?.columnFilters?.a).toHaveLength(500);
  });

  it("describes the view for the Share popup", () => {
    expect(
      describeShareView({
        columnFilters: { a: ["x"], b: ["y"] },
        status: "done",
        search: "q",
        sort: { column: "a", direction: "asc" },
      })
    ).toBe("2 column filters, done rows, search, sorted");
    expect(describeShareView(null)).toBe("");
  });

  it("compares views regardless of value order", () => {
    expect(shareViewKey({ columnFilters: { a: ["y", "x"] } })).toBe(shareViewKey({ columnFilters: { a: ["x", "y"] } }));
  });
});
