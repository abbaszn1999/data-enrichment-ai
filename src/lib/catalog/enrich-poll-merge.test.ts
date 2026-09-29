import { describe, expect, it } from "vitest";
import {
  catalogRunFinishedCounts,
  enrichPollDelayMs,
  overlayCatalogRowsForActiveRun,
} from "./enrich-poll-merge";

describe("enrichPollDelayMs", () => {
  it("checks a fresh run often, then settles into a slower rhythm", () => {
    expect(enrichPollDelayMs(0, 0)).toBe(5_000);
    expect(enrichPollDelayMs(119_999, 0)).toBe(5_000);
    expect(enrichPollDelayMs(120_000, 0)).toBe(8_000);
    expect(enrichPollDelayMs(600_000, 0)).toBe(12_000);
    expect(enrichPollDelayMs(3_600_000, 0)).toBe(12_000);
  });

  it("is never faster than 5s, so 300 open tabs stay under ~60 requests/second", () => {
    for (const elapsed of [0, 60_000, 300_000, 900_000]) {
      expect(enrichPollDelayMs(elapsed, 0)).toBeGreaterThanOrEqual(5_000);
    }
  });

  it("backs off after failures but never past 20s", () => {
    expect(enrichPollDelayMs(0, 1)).toBe(10_000);
    expect(enrichPollDelayMs(0, 5)).toBe(20_000);
    expect(enrichPollDelayMs(900_000, 1)).toBe(20_000);
  });
});

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
