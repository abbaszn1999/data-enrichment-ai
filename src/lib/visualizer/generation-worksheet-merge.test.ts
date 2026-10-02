import { describe, expect, it } from "vitest";
import {
  adoptIncomingVisualizerWorksheet,
  mergePolledVisualizerRow,
  mergePolledVisualizerWorksheet,
  rotateWatchedRowIds,
} from "@/lib/visualizer/generation-worksheet-merge";
import type {
  VisualizerRow,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

function row(overrides: Partial<VisualizerRow> = {}): VisualizerRow {
  return {
    id: "r1",
    rowIndex: 0,
    status: "not_started",
    originalData: {},
    ...overrides,
  };
}

function worksheet(
  rows: VisualizerRow[],
  revision: number,
  overrides: Partial<VisualizerWorksheetJson> = {}
): VisualizerWorksheetJson {
  return {
    sessionId: "s1",
    columns: [],
    settings: {} as VisualizerWorksheetJson["settings"],
    activeRun: null,
    rows,
    revision,
    ...overrides,
  };
}

const oldResult = {
  generatedDescription: "<p>old description</p>",
  imagePlaceholders: [
    { index: 1, visualBrief: "a", alt: "a", storagePath: "rows/r1/old-1.webp" },
  ],
};

const newResult = {
  generatedDescription: "<p>new description</p>",
  imagePlaceholders: [
    { index: 1, visualBrief: "a", alt: "a", storagePath: "rows/r1/new-1.webp" },
  ],
};

describe("mergePolledVisualizerRow", () => {
  it("keeps the loading state when the pre-run result is polled during the request", () => {
    const local = row({ status: "generating", generationStage: "description", ...oldResult });
    const polled = row({ status: "images_ready", ...oldResult });
    const merged = mergePolledVisualizerRow(local, polled, { clientRunActive: true });
    expect(merged.status).toBe("generating");
  });

  it("accepts a finished row whose result differs from the one held locally", () => {
    const local = row({ status: "generating", generationStage: "description", ...oldResult });
    const polled = row({ status: "images_ready", ...newResult });
    const merged = mergePolledVisualizerRow(local, polled, { clientRunActive: true });
    expect(merged.status).toBe("images_ready");
    expect(merged.generatedDescription).toBe("<p>new description</p>");
  });

  it("accepts a first-time result for a row that had nothing before", () => {
    const local = row({ status: "generating", generationStage: "description" });
    const polled = row({ status: "images_ready", ...newResult });
    expect(
      mergePolledVisualizerRow(local, polled, { clientRunActive: true }).status
    ).toBe("images_ready");
  });

  it("accepts a failure while the request is open", () => {
    const local = row({ status: "generating", generationStage: "description" });
    const polled = row({ status: "failed", errorMessage: "boom" });
    expect(
      mergePolledVisualizerRow(local, polled, { clientRunActive: true }).status
    ).toBe("failed");
  });

  it("treats storage as authoritative once the request has returned", () => {
    const local = row({ status: "generating", generationStage: "images", ...oldResult });
    const polled = row({ status: "images_ready", ...newResult });
    expect(
      mergePolledVisualizerRow(local, polled, { clientRunActive: false }).status
    ).toBe("images_ready");
  });

  it("follows live server progress", () => {
    const local = row({ status: "generating", generationStage: "description", ...oldResult });
    const polled = row({ status: "generating", generationStage: "images", ...newResult });
    const merged = mergePolledVisualizerRow(local, polled, { clientRunActive: false });
    expect(merged.generationStage).toBe("images");
  });
});

describe("adoptIncomingVisualizerWorksheet", () => {
  it("does not bring the loading back to a row the poll already finished", () => {
    const current = worksheet([row({ status: "images_ready", ...newResult })], 4);
    const incoming = worksheet(
      [row({ status: "generating", generationStage: "description", ...oldResult })],
      5
    );
    const adopted = adoptIncomingVisualizerWorksheet(current, incoming);
    expect(adopted.rows[0]!.status).toBe("images_ready");
    expect(adopted.rows[0]!.generatedDescription).toBe("<p>new description</p>");
  });

  it("adopts the generating rows of a run that has just started", () => {
    const current = worksheet(
      [row({ status: "generating", generationStage: "description", ...oldResult })],
      4
    );
    const incoming = worksheet(
      [row({ status: "generating", generationStage: "description", ...oldResult })],
      5
    );
    expect(adoptIncomingVisualizerWorksheet(current, incoming).rows[0]!.status).toBe(
      "generating"
    );
  });
});

describe("mergePolledVisualizerWorksheet", () => {
  it("ignores an older snapshot", () => {
    const local = worksheet([row({ status: "images_ready", ...newResult })], 6);
    const polled = worksheet([row({ status: "generating" })], 5);
    expect(
      mergePolledVisualizerWorksheet({ local, polled, clientRunActive: false })
    ).toBe(local);
  });

  it("applies the finished rows after the run ended", () => {
    const local = worksheet(
      [row({ status: "generating", generationStage: "images", ...oldResult })],
      5
    );
    const polled = worksheet([row({ status: "images_ready", ...newResult })], 7);
    const merged = mergePolledVisualizerWorksheet({
      local,
      polled,
      clientRunActive: false,
    });
    expect(merged.rows[0]!.status).toBe("images_ready");
    expect(merged.revision).toBe(7);
  });
});

describe("rotateWatchedRowIds", () => {
  it("returns every id when they fit in one request", () => {
    expect(rotateWatchedRowIds(["a", "b"], 3)).toEqual(["a", "b"]);
  });

  it("covers every id across successive polls of a large run", () => {
    const ids = Array.from({ length: 250 }, (_, index) => `row-${index}`);
    const seen = new Set<string>();
    for (let poll = 0; poll < 3; poll += 1) {
      const window = rotateWatchedRowIds(ids, poll, 100);
      expect(window.length).toBeLessThanOrEqual(100);
      window.forEach((id) => seen.add(id));
    }
    expect(seen.size).toBe(250);
  });
});
