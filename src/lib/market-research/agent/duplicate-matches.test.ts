import { describe, expect, it } from "vitest";
import { parseDuplicateExclusionResponse } from "./duplicate-matches";

const existingById = new Map([
  ["ex-1", "Women's Gucci Eyewear"],
  ["ex-2", "Sunglasses"],
]);
const validNewIds = new Set(["col-1", "col-2"]);

describe("parseDuplicateExclusionResponse", () => {
  it("flags a duplicate even when the agent omits the live PLP", () => {
    const result = parseDuplicateExclusionResponse(
      { duplicates: [{ id: "col-1", status: "duplicate" }] },
      validNewIds,
      existingById
    );
    expect([...result.duplicateIds]).toEqual(["col-1"]);
    expect(result.matchesById.has("col-1")).toBe(false);
  });

  it("stores named matches when existingId and existingName are present", () => {
    const result = parseDuplicateExclusionResponse(
      {
        duplicates: [
          {
            id: "col-1",
            status: "duplicate",
            existingId: "ex-1",
            existingName: "Women's Gucci Eyewear",
          },
        ],
      },
      validNewIds,
      existingById
    );
    expect([...result.duplicateIds]).toEqual(["col-1"]);
    expect(result.matchesById.get("col-1")).toEqual([
      { id: "ex-1", name: "Women's Gucci Eyewear" },
    ]);
  });

  it("fills the name from the catalog when only existingId is returned", () => {
    const result = parseDuplicateExclusionResponse(
      { duplicates: [{ id: "col-1", status: "duplicate", existingId: "ex-2" }] },
      validNewIds,
      existingById
    );
    expect(result.matchesById.get("col-1")).toEqual([{ id: "ex-2", name: "Sunglasses" }]);
  });

  it("unions extra matches without dropping the primary existingId", () => {
    const result = parseDuplicateExclusionResponse(
      {
        duplicates: [
          {
            id: "col-1",
            status: "duplicate",
            existingId: "ex-1",
            existingName: "Women's Gucci Eyewear",
            matches: [{ id: "ex-2", name: "Sunglasses" }],
          },
        ],
      },
      validNewIds,
      existingById
    );
    expect(result.matchesById.get("col-1")).toEqual([
      { id: "ex-1", name: "Women's Gucci Eyewear" },
      { id: "ex-2", name: "Sunglasses" },
    ]);
  });

  it("ignores unknown new-collection ids", () => {
    const result = parseDuplicateExclusionResponse(
      { duplicates: [{ id: "nope", status: "duplicate", existingId: "ex-1" }] },
      validNewIds,
      existingById
    );
    expect(result.duplicateIds.size).toBe(0);
    expect(result.matchesById.size).toBe(0);
  });
});
