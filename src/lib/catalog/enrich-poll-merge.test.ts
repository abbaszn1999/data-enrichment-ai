import { describe, expect, it } from "vitest";
import { catalogRunFinishedCounts, overlayCatalogRowsForActiveRun } from "./enrich-poll-merge";

const rows = [
  { id: "r1", status: "done" },
  { id: "r2", status: "done" },
  { id: "r3", status: "error" },
  { id: "r4", status: "pending" },
];

describe("catalogRunFinishedCounts", () => {
  it("counts only rows this run processed, by their saved status", () => {
    const run = { status: "running", settings: { processedRowIds: ["r2", "r3"] } };
    expect(catalogRunFinishedCounts(rows, run)).toEqual({ done: 1, failed: 1 });
  });

  it("does not count rows that were already done before this run (e.g. a Premium retry of Not-found rows)", () => {
    const run = { status: "running", target_ids: ["r1", "r2"], settings: { processedRowIds: [] } };
    expect(catalogRunFinishedCounts(rows, run)).toEqual({ done: 0, failed: 0 });
  });

  it("falls back to the run's own counters before the first row is recorded", () => {
    expect(catalogRunFinishedCounts(rows, { completed_count: 2, failed_count: 1 })).toEqual({ done: 2, failed: 1 });
  });
});

describe("overlayCatalogRowsForActiveRun", () => {
  it("shows unprocessed targets as working and processed ones with their real status", () => {
    const run = { status: "running", target_ids: ["r1", "r4"], settings: { processedRowIds: ["r1"] } };
    const overlaid = overlayCatalogRowsForActiveRun(rows, run);
    expect(overlaid.find((row) => row.id === "r1")?.status).toBe("done");
    expect(overlaid.find((row) => row.id === "r4")?.status).toBe("processing");
  });
});
