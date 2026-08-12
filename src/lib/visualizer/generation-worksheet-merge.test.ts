import { describe, expect, it } from "vitest";
import {
  mergePolledVisualizerRow,
  mergePolledVisualizerWorksheet,
} from "@/lib/visualizer/generation-worksheet-merge";
import {
  DEFAULT_VISUALIZER_SETTINGS,
  type VisualizerRow,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

function row(partial: Partial<VisualizerRow> & { id: string }): VisualizerRow {
  return {
    rowIndex: 0,
    status: "not_started",
    originalData: { SKU: partial.id },
    ...partial,
  };
}

function sheet(rows: VisualizerRow[]): VisualizerWorksheetJson {
  return {
    sessionId: "session-1",
    columns: ["SKU"],
    settings: DEFAULT_VISUALIZER_SETTINGS,
    activeRun: {
      id: "run-1",
      phase: "full",
      status: "running",
      total: 1,
      completed: 0,
      failed: 0,
      selectedRowIds: ["row-a"],
      startedAt: new Date().toISOString(),
    },
    rows,
  };
}

describe("visualizer poll merge", () => {
  it("keeps optimistic generating when poll returns stale idle", () => {
    const merged = mergePolledVisualizerRow(
      row({
        id: "row-a",
        status: "generating",
        generationStage: "description",
      }),
      row({ id: "row-a", status: "not_started" }),
      { clientRunActive: true }
    );
    expect(merged.status).toBe("generating");
    expect(merged.generationStage).toBe("description");
  });

  it("takes live generating progress from the server", () => {
    const merged = mergePolledVisualizerRow(
      row({
        id: "row-a",
        status: "generating",
        generationStage: "description",
      }),
      row({
        id: "row-a",
        status: "generating",
        generationStage: "images",
        generatedDescription: "<p>Ready</p>",
      }),
      { clientRunActive: true }
    );
    expect(merged.generationStage).toBe("images");
    expect(merged.generatedDescription).toBe("<p>Ready</p>");
  });

  it("preserves local activeRun when poll has not observed it", () => {
    const local = sheet([
      row({
        id: "row-a",
        status: "generating",
        generationStage: "planning",
      }),
    ]);
    const polled = sheet([row({ id: "row-a", status: "not_started" })]);
    polled.activeRun = null;

    const merged = mergePolledVisualizerWorksheet({
      local,
      polled,
      clientRunActive: true,
    });
    expect(merged.activeRun?.status).toBe("running");
    expect(merged.rows[0]?.status).toBe("generating");
  });
});
