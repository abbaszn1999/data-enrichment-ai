import { describe, expect, it } from "vitest";
import { compactFromTo, restoreSnapshot } from "./sheet-history";

describe("sheet history patches", () => {
  it("stores only changed cells and restores the previous sheet", () => {
    const from = {
      title: "Products",
      columns: ["title", "sku"],
      rows: [
        { title: "A", sku: "1" },
        { title: "B", sku: "2" },
      ],
    };
    const to = {
      title: "Products",
      columns: ["title", "sku"],
      rows: [
        { title: "A+", sku: "1" },
        { title: "B", sku: "2" },
      ],
    };
    const compact = compactFromTo(from, to);
    expect(compact.kind).toBe("patch");
    if (compact.kind !== "patch") return;
    expect(compact.patches).toEqual([{ rowIndex: 0, key: "title", value: "A" }]);
    expect(restoreSnapshot(to, compact)).toEqual(from);
  });

  it("falls back to a full snapshot when the shape changes", () => {
    const from = {
      title: "Products",
      columns: ["title"],
      rows: [{ title: "A" }],
    };
    const to = {
      title: "Products",
      columns: ["title", "sku"],
      rows: [{ title: "A", sku: "1" }],
    };
    const compact = compactFromTo(from, to);
    expect(compact.kind).toBe("full");
  });
});
