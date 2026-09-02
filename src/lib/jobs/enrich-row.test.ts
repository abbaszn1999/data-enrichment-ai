import { describe, expect, it } from "vitest";
import {
  catalogCreditIdempotencyKey,
  catalogPendingRowIds,
} from "./enrich-row";

describe("catalogPendingRowIds", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("keeps already-done rows so a new column pass still runs", () => {
    expect(catalogPendingRowIds(["a", "b", "c"], rows)).toEqual(["a", "b", "c"]);
  });

  it("skips only rows this same run already processed", () => {
    expect(catalogPendingRowIds(["a", "b", "c"], rows, ["a"])).toEqual(["b", "c"]);
  });

  it("drops ids that are not in the project", () => {
    expect(catalogPendingRowIds(["a", "missing"], rows)).toEqual(["a"]);
  });
});

describe("catalogCreditIdempotencyKey", () => {
  it("scopes charges to the job run so a later column pass can bill again", () => {
    expect(catalogCreditIdempotencyKey("run-1", "row-1")).toBe(
      "catalog_intelligence:run-1:row-1"
    );
    expect(catalogCreditIdempotencyKey("run-2", "row-1")).not.toBe(
      catalogCreditIdempotencyKey("run-1", "row-1")
    );
  });
});
