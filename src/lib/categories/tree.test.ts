import { describe, expect, it } from "vitest";
import {
  buildAncestorSets,
  categoryPathKey,
  flattenExpanded,
  isDescendantOf,
  rollupProductCounts,
} from "./tree";

const cats = [
  { id: "a", name: "Apparel", parentId: null },
  { id: "m", name: "Accessories", parentId: "a" },
  { id: "e", name: "Electronics", parentId: null },
  { id: "x", name: "Accessories", parentId: "e" },
];

describe("categoryPathKey", () => {
  it("distinguishes same leaf names under different parents", () => {
    const byId = new Map(cats.map((c) => [c.id, c]));
    expect(categoryPathKey(cats[1], byId)).not.toBe(categoryPathKey(cats[3], byId));
    expect(categoryPathKey(cats[1], byId)).toBe("apparel\0accessories");
    expect(categoryPathKey(cats[3], byId)).toBe("electronics\0accessories");
  });
});

describe("ancestor sets", () => {
  it("answers isDescendant in O(1)", () => {
    const sets = buildAncestorSets(cats);
    expect(isDescendantOf("a", "m", sets)).toBe(true);
    expect(isDescendantOf("a", "x", sets)).toBe(false);
    expect(isDescendantOf("m", "a", sets)).toBe(false);
  });
});

describe("rollupProductCounts", () => {
  it("sums descendants into the parent", () => {
    const counts = rollupProductCounts(cats, { m: 3, x: 5, a: 1 });
    expect(counts.get("m")).toEqual({ direct: 3, rollup: 3 });
    expect(counts.get("a")).toEqual({ direct: 1, rollup: 4 });
    expect(counts.get("e")).toEqual({ direct: 0, rollup: 5 });
  });
});

describe("flattenExpanded", () => {
  it("omits collapsed children", () => {
    const tree = [
      {
        id: "a",
        children: [{ id: "m", children: [] }],
      },
    ];
    expect(flattenExpanded(tree, new Set()).map((r) => r.node.id)).toEqual(["a"]);
    expect(flattenExpanded(tree, new Set(["a"])).map((r) => r.node.id)).toEqual([
      "a",
      "m",
    ]);
  });
});
