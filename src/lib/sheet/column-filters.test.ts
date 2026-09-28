import { describe, expect, it } from "vitest";
import {
  applyColumnFilters,
  BLANK_VALUE,
  bucketFilterValues,
  clearColumnFilter,
  columnFilterValues,
  hasActiveFilters,
  setColumnFilter,
  type ColumnFilters,
} from "./column-filters";

const rows = [
  { id: "1", brand: "Paktat", status: "found" },
  { id: "2", brand: "Paktat", status: "not_found" },
  { id: "3", brand: "", status: "not_found" },
  { id: "4", brand: "Acme", status: "found" },
];

describe("columnFilterValues", () => {
  it("counts distinct values, most common first, and blanks last", () => {
    const options = columnFilterValues(rows, (r) => r.brand);
    expect(options).toEqual([
      { value: "Paktat", label: "Paktat", count: 2 },
      { value: "Acme", label: "Acme", count: 1 },
      { value: BLANK_VALUE, label: "(Blanks)", count: 1 },
    ]);
  });
});

describe("bucketFilterValues", () => {
  it("only returns buckets that actually occur", () => {
    const buckets = [
      { value: "found", label: "Has images" },
      { value: "not_found", label: "Not found" },
      { value: "not_processed", label: "Not processed" },
    ];
    const options = bucketFilterValues(rows, buckets, (r) => r.status);
    expect(options).toEqual([
      { value: "found", label: "Has images", count: 2 },
      { value: "not_found", label: "Not found", count: 2 },
    ]);
  });
});

describe("applyColumnFilters", () => {
  const getValue = (row: (typeof rows)[number], key: string) => (key === "brand" ? row.brand : row.status);

  it("returns every row when nothing is filtered", () => {
    expect(applyColumnFilters(rows, {}, getValue)).toEqual(rows);
  });

  it("filters a single column", () => {
    const filters: ColumnFilters = { status: new Set(["not_found"]) };
    expect(applyColumnFilters(rows, filters, getValue).map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("matches blanks via the sentinel value", () => {
    const filters: ColumnFilters = { brand: new Set([BLANK_VALUE]) };
    expect(applyColumnFilters(rows, filters, getValue).map((r) => r.id)).toEqual(["3"]);
  });

  it("ANDs across columns", () => {
    const filters: ColumnFilters = { brand: new Set(["Paktat"]), status: new Set(["not_found"]) };
    expect(applyColumnFilters(rows, filters, getValue).map((r) => r.id)).toEqual(["2"]);
  });
});

describe("hasActiveFilters / setColumnFilter / clearColumnFilter", () => {
  it("tracks whether any column is filtered", () => {
    expect(hasActiveFilters({})).toBe(false);
    const withFilter = setColumnFilter({}, "status", new Set(["found"]));
    expect(hasActiveFilters(withFilter)).toBe(true);
    expect(hasActiveFilters(clearColumnFilter(withFilter, "status"))).toBe(false);
  });

  it("setColumnFilter with an empty set clears the column", () => {
    const withFilter = setColumnFilter({}, "status", new Set(["found"]));
    expect(setColumnFilter(withFilter, "status", new Set())).toEqual({});
  });
});
