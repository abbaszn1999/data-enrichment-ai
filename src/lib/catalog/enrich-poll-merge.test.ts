import { describe, expect, it } from "vitest";
import {
  catalogEnrichingContextFromRun,
  catalogPollShouldApplySnapshot,
  overlayCatalogRowsForActiveRun,
} from "./enrich-poll-merge";

const rows = [
  { id: "a", status: "done" },
  { id: "b", status: "pending" },
  { id: "c", status: "error" },
];

describe("overlayCatalogRowsForActiveRun", () => {
  it("marks targeted done/error rows processing until this run checkpoints them", () => {
    const next = overlayCatalogRowsForActiveRun(rows, {
      status: "running",
      target_ids: ["a", "c"],
      settings: { processedRowIds: [] },
    });
    expect(next.find((row) => row.id === "a")?.status).toBe("processing");
    expect(next.find((row) => row.id === "b")?.status).toBe("pending");
    expect(next.find((row) => row.id === "c")?.status).toBe("processing");
  });

  it("keeps checkpointed rows as stored so new text can replace the skeleton", () => {
    const next = overlayCatalogRowsForActiveRun(rows, {
      status: "running",
      target_ids: ["a", "c"],
      settings: { processedRowIds: ["a"] },
    });
    expect(next.find((row) => row.id === "a")?.status).toBe("done");
    expect(next.find((row) => row.id === "c")?.status).toBe("processing");
  });

  it("does not overlay after the job leaves queued/running", () => {
    const next = overlayCatalogRowsForActiveRun(rows, {
      status: "completed",
      target_ids: ["a"],
    });
    expect(next.find((row) => row.id === "a")?.status).toBe("done");
  });
});

describe("catalogPollShouldApplySnapshot", () => {
  it("drops a stale poll from a previous epoch", () => {
    expect(
      catalogPollShouldApplySnapshot({
        epoch: 1,
        currentEpoch: 2,
        localRunId: "run-2",
        locallyEnriching: true,
        run: { id: "run-1", status: "completed" },
      })
    ).toBe("ignore");
  });

  it("ignores a snapshot with no run while the client already started enrich", () => {
    expect(
      catalogPollShouldApplySnapshot({
        epoch: 2,
        currentEpoch: 2,
        localRunId: null,
        locallyEnriching: true,
        run: null,
      })
    ).toBe("ignore");
  });

  it("applies the terminal snapshot for the run this client started", () => {
    expect(
      catalogPollShouldApplySnapshot({
        epoch: 2,
        currentEpoch: 2,
        localRunId: "run-2",
        locallyEnriching: true,
        run: { id: "run-2", status: "completed" },
      })
    ).toBe("apply");
  });
});

describe("catalogEnrichingContextFromRun", () => {
  it("uses the existing-columns tab when the job targeted original fields", () => {
    expect(
      catalogEnrichingContextFromRun({
        settings: { enabledColumns: ["existing__Title", "existing__Body"] },
      })
    ).toEqual({
      tab: "existing",
      existingColumns: ["Title", "Body"],
    });
  });
});
