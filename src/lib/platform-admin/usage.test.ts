import { describe, expect, it } from "vitest";
import { EMPTY_USAGE, sumUsage, usageOf } from "./usage";

describe("usage helpers", () => {
  it("sums owned workspace usage", () => {
    expect(
      sumUsage([
        { storageBytes: 100, objectCount: 2, dbBytes: 10 },
        { storageBytes: 50, objectCount: 1, dbBytes: 5 },
      ])
    ).toEqual({ storageBytes: 150, objectCount: 3, dbBytes: 15 });
  });

  it("returns empty usage for unknown workspaces", () => {
    expect(usageOf(new Map(), "missing")).toEqual(EMPTY_USAGE);
  });
});
