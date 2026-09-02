import { describe, expect, it } from "vitest";
import {
  adoptIncomingVisualizerWorksheet,
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

  it("takes images_ready from a newer revision while generate is in flight", () => {
    const local = sheet([
      row({
        id: "row-a",
        status: "generating",
        generationStage: "planning",
      }),
    ]);
    local.revision = 2;
    const polled = sheet([
      row({
        id: "row-a",
        status: "images_ready",
        generatedDescription: "<p>Done</p>",
        imagePlaceholders: [
          { index: 0, visualBrief: "front", alt: "front", storagePath: "a.webp" },
        ],
      }),
    ]);
    polled.revision = 3;
    polled.activeRun = {
      ...polled.activeRun!,
      status: "completed",
      completed: 1,
    };

    const merged = mergePolledVisualizerWorksheet({
      local,
      polled,
      clientRunActive: true,
    });

    expect(merged.rows[0]?.status).toBe("images_ready");
    expect(merged.activeRun?.status).toBe("completed");
  });

  it("ignores a stale generate 202 older than the polled worksheet", () => {
    const current = sheet([
      row({
        id: "row-a",
        status: "images_ready",
        generatedDescription: "<p>Done</p>",
      }),
    ]);
    current.revision = 4;
    current.activeRun = { ...current.activeRun!, status: "completed" };
    const incoming = sheet([
      row({
        id: "row-a",
        status: "generating",
        generationStage: "planning",
      }),
    ]);
    incoming.revision = 3;

    const adopted = adoptIncomingVisualizerWorksheet(current, incoming);
    expect(adopted.revision).toBe(4);
    expect(adopted.rows[0]?.status).toBe("images_ready");
  });
});
