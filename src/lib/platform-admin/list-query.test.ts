import { describe, expect, it } from "vitest";
import { inDateWindow, matchesLastSeen, sortRows, toggleSort } from "./list-query";

describe("list-query", () => {
  it("sorts nulls last and toggles direction", () => {
    const rows = [
      { name: "b", n: 2 },
      { name: "a", n: null as number | null },
      { name: "c", n: 1 },
    ];
    const asc = sortRows(rows, { key: "n", dir: "asc" }, { n: (row) => row.n });
    expect(asc.map((row) => row.name)).toEqual(["c", "b", "a"]);
    expect(toggleSort({ key: "n", dir: "asc" }, "n")).toEqual({ key: "n", dir: "desc" });
  });

  it("matches date windows", () => {
    const now = new Date().toISOString();
    expect(inDateWindow(now, "7d")).toBe(true);
    expect(inDateWindow(null, "7d")).toBe(false);
    expect(matchesLastSeen(null, "never")).toBe(true);
    expect(matchesLastSeen(now, "never")).toBe(false);
  });
});
