import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = {
  delta: [] as Array<{ projectId: string; rows: Array<{ id: string }>; meta?: unknown }>,
  full: [] as string[],
};
let releaseSave: (() => void) | null = null;

vi.mock("@/lib/storage-helpers", () => ({
  saveProjectDelta: async (_workspaceId: string, projectId: string, delta: { rows: Array<{ id: string }>; meta?: unknown }) => {
    calls.delta.push({ projectId, rows: delta.rows, meta: delta.meta });
    if (releaseSave) await new Promise<void>((resolve) => (releaseSave = resolve));
    return { ok: true };
  },
  saveProjectJson: async (_workspaceId: string, projectId: string) => {
    calls.full.push(projectId);
    return "path";
  },
}));
vi.mock("@/lib/supabase", () => ({ updateImportSession: async () => ({}) }));
vi.mock("@/lib/persistence", () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn(() => null),
  clearSession: vi.fn(),
}));

import { flushProjectSave, useSheetStore } from "./sheet-store";
import type { ProductRow } from "@/types";

function makeRows(prefix = "r"): ProductRow[] {
  return [0, 1].map((index) => ({
    id: `${prefix}${index}`,
    rowIndex: index,
    selected: false,
    status: "pending",
    originalData: { Title: `Item ${index}` },
    enrichedData: {},
    matchType: "new",
  }));
}

function open(projectId = "p1", rows = makeRows()) {
  useSheetStore
    .getState()
    .loadProject("w1", projectId, "Sheet", ["Title"], rows, ["Title"], [], {} as never, {}, "product");
}

describe("catalog sheet autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.delta = [];
    calls.full = [];
    releaseSave = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads as saved right after a project opens and schedules nothing", async () => {
    open();
    expect(useSheetStore.getState().saveStatus).toBe("saved");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.delta).toHaveLength(0);
    expect(calls.full).toHaveLength(0);
  });

  it("treats rows applied from the server (a finished run) as saved", async () => {
    open();
    const enriched = useSheetStore.getState().rows.map((row) => ({
      ...row,
      status: "done" as const,
      enrichedData: { seo_title: `SEO ${row.id}` },
    }));
    useSheetStore.getState().applyProjectRows(enriched, { completed: 2, total: 2, errors: 0 });
    expect(useSheetStore.getState().saveStatus).toBe("saved");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.delta).toHaveLength(0);
  });

  it("marks an edit unsaved and stores only that row", async () => {
    open();
    useSheetStore.getState().updateCellValue("r1", "Title", "Renamed");
    expect(useSheetStore.getState().saveStatus).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(calls.delta).toHaveLength(1);
    expect(calls.delta[0]!.rows.map((row) => row.id)).toEqual(["r1"]);
    expect(useSheetStore.getState().saveStatus).toBe("saved");
  });

  it("flushes a pending edit at once when leaving", async () => {
    open();
    useSheetStore.getState().updateCellValue("r0", "Title", "Now");
    await flushProjectSave();
    expect(calls.delta).toHaveLength(1);
    expect(useSheetStore.getState().saveStatus).toBe("saved");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.delta).toHaveLength(1);
  });

  it("does not save rows while a background run owns them", async () => {
    open();
    useSheetStore.getState().setIsEnriching(true);
    useSheetStore.getState().setRowStatus("r0", "processing");
    expect(useSheetStore.getState().saveStatus).toBe("saved");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.delta).toHaveLength(0);
    useSheetStore.getState().setIsEnriching(false);
  });

  it("keeps the new project's baseline when an older save finishes after a switch", async () => {
    open("p1");
    useSheetStore.getState().updateCellValue("r0", "Title", "Edited");
    releaseSave = () => undefined;
    const pending = flushProjectSave();
    await vi.advanceTimersByTimeAsync(0);
    open("p2", makeRows("q"));
    releaseSave?.();
    await pending;
    expect(calls.delta[0]!.projectId).toBe("p1");
    expect(useSheetStore.getState().projectId).toBe("p2");
    expect(useSheetStore.getState().saveStatus).toBe("saved");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.delta).toHaveLength(1);
  });
});
