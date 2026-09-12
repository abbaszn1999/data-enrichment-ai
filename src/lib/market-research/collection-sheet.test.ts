import { describe, expect, it } from "vitest";
import type { ProposedCollection } from "@/components/market-research/workspace-data";
import {
  DEFAULT_COLLECTION_FILTERS,
  collectionFiltersEqual,
  filterProposedCollections,
  pageSelectionState,
  removeSelectedIds,
  selectedDuplicateIds,
  unionSelectedIds,
  clearSelectedContent,
} from "./collection-sheet";

function col(
  partial: Partial<ProposedCollection> & { id: string; name: string }
): ProposedCollection {
  return {
    headKeyword: partial.name,
    parentNiche: "Audio",
    volume: 20,
    difficulty: 10,
    productCount: 4,
    keywordCount: 1,
    status: "new",
    ...partial,
  };
}

describe("collectionFiltersEqual", () => {
  it("treats defaults as equal and detects draft edits", () => {
    expect(
      collectionFiltersEqual(DEFAULT_COLLECTION_FILTERS, { ...DEFAULT_COLLECTION_FILTERS })
    ).toBe(true);
    expect(
      collectionFiltersEqual(DEFAULT_COLLECTION_FILTERS, {
        ...DEFAULT_COLLECTION_FILTERS,
        minVolume: 50,
      })
    ).toBe(false);
  });
});

describe("filterProposedCollections", () => {
  const rows = [
    col({ id: "a", name: "Personal Audio", volume: 40, difficulty: 10, productCount: 4 }),
    col({
      id: "b",
      name: "Headphones",
      volume: 10,
      difficulty: 80,
      productCount: 1,
      status: "duplicate",
    }),
    col({ id: "c", name: "Bluetooth Speakers", volume: 200, difficulty: 20, productCount: 8, parentNiche: "Home" }),
  ];

  it("applies volume / KD / products / query only after those values are set", () => {
    const filtered = filterProposedCollections(
      rows,
      { query: "audio", minVolume: 30, maxKd: 50, minProducts: 2 },
      "all"
    );
    expect(filtered.map((r) => r.id)).toEqual(["a"]);
  });

  it("live status view can hide duplicates without changing numeric filters", () => {
    const withoutDupes = filterProposedCollections(
      rows,
      DEFAULT_COLLECTION_FILTERS,
      "new"
    );
    expect(withoutDupes.map((r) => r.id)).toEqual(["a", "c"]);
    const onlyDupes = filterProposedCollections(
      rows,
      DEFAULT_COLLECTION_FILTERS,
      "duplicate"
    );
    expect(onlyDupes.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("selection helpers", () => {
  it("select page unions ids without dropping earlier pages", () => {
    expect(unionSelectedIds(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("unselect page removes only those ids", () => {
    expect(removeSelectedIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("page checkbox is empty, partial, or filled from the current page only", () => {
    expect(pageSelectionState(["a", "b"], new Set())).toEqual({
      allSelected: false,
      someSelected: false,
    });
    expect(pageSelectionState(["a", "b"], new Set(["a"]))).toEqual({
      allSelected: false,
      someSelected: true,
    });
    expect(pageSelectionState(["a", "b"], new Set(["a", "b", "z"]))).toEqual({
      allSelected: true,
      someSelected: false,
    });
  });

  it("counts duplicates inside the left-side selection only", () => {
    const rows = [
      col({ id: "a", name: "A", status: "duplicate" }),
      col({ id: "b", name: "B", status: "duplicate" }),
      col({ id: "c", name: "C" }),
    ];
    expect(selectedDuplicateIds(rows, new Set(["a", "c"]))).toEqual(["a"]);
    expect(selectedDuplicateIds(rows, new Set(["c"]))).toEqual([]);
  });
});

describe("clearSelectedContent", () => {
  it("drops only the ids about to be regenerated", () => {
    const current = {
      a: { title: "keep-a" },
      b: { title: "wipe-b" },
      c: { title: "keep-c" },
    };
    expect(clearSelectedContent(current, ["b"])).toEqual({
      a: { title: "keep-a" },
      c: { title: "keep-c" },
    });
  });

  it("leaves the map unchanged when nothing is selected", () => {
    const current = { a: { title: "keep-a" } };
    expect(clearSelectedContent(current, [])).toBe(current);
  });
});
