import { describe, expect, it } from "vitest";
import {
  applyGenerationRowPatch,
  pathsRemovedByUser,
  reconcileGenerationWorksheet,
} from "@/lib/gallery/generation-worksheet-merge";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  type GalleryRow,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";

function row(partial: Partial<GalleryRow> & { id: string }): GalleryRow {
  return {
    rowIndex: 0,
    status: "ready",
    originalData: { SKU: partial.id },
    mainImagePath: null,
    mainImagePaths: [],
    galleryImagePaths: [],
    ...partial,
  };
}

function sheet(rows: GalleryRow[]): GalleryWorksheetJson {
  return {
    sessionId: "session-1",
    columns: ["SKU"],
    originalImageColumn: null,
    originalImageSelectionExplicit: true,
    selectedColumns: ["SKU"],
    settings: {
      provider: "scraping",
      scraping: DEFAULT_SCRAPING_SETTINGS,
      ai: DEFAULT_AI_SETTINGS,
    },
    activeRun: {
      id: "run-1",
      status: "running",
      provider: "scraping",
      selectedRowIds: ["row-a"],
      total: 1,
      completed: 0,
      failed: 0,
      estimatedCredits: 1,
      usedCredits: 0,
      cancelRequested: false,
      startedAt: new Date().toISOString(),
    },
    rows,
  };
}

describe("generation worksheet merge", () => {
  it("detects paths the user removed from storage", () => {
    expect(
      pathsRemovedByUser(
        ["a.webp", "b.webp"],
        ["b.webp"]
      )
    ).toEqual(["a.webp"]);
  });

  it("does not revive a main image the user deleted mid-run", () => {
    const memoryRow = row({
      id: "row-a",
      status: "generating",
      mainImagePaths: ["main-1.webp", "main-2.webp"],
      mainImagePath: "main-1.webp",
    });
    const storageRow = row({
      id: "row-a",
      status: "generating",
      mainImagePaths: ["main-2.webp"],
      mainImagePath: "main-2.webp",
    });

    const next = applyGenerationRowPatch({
      storageRow,
      memoryRow,
      patch: {
        mainImagePaths: ["main-1.webp", "main-2.webp", "main-3.webp"],
        mainImagePath: "main-1.webp",
        generationStage: "main",
      },
    });

    expect(next.mainImagePaths).toEqual(["main-2.webp", "main-3.webp"]);
    expect(next.mainImagePath).toBe("main-2.webp");
    expect(next.generationStage).toBe("main");
  });

  it("keeps storage rows authoritative when they are outside the run", () => {
    const memory = sheet([
      row({
        id: "row-a",
        status: "generating",
        mainImagePaths: ["a-old.webp"],
        mainImagePath: "a-old.webp",
      }),
      row({
        id: "row-b",
        status: "ready",
        mainImagePaths: ["b-memory.webp"],
        mainImagePath: "b-memory.webp",
        galleryImagePaths: ["https://cdn.example/shared.jpg"],
      }),
    ]);
    const storage = sheet([
      row({
        id: "row-a",
        status: "generating",
        mainImagePaths: [],
        mainImagePath: null,
      }),
      row({
        id: "row-b",
        status: "ready",
        mainImagePaths: ["b-storage.webp"],
        mainImagePath: "b-storage.webp",
        galleryImagePaths: [],
      }),
    ]);
    storage.activeRun = null;

    const merged = reconcileGenerationWorksheet({
      memory,
      storage,
      targetRowIds: new Set(["row-a"]),
    });

    expect(merged.activeRun?.status).toBe("running");
    expect(merged.rows[0]?.mainImagePaths).toEqual([]);
    expect(merged.rows[1]?.mainImagePaths).toEqual(["b-storage.webp"]);
    expect(merged.rows[1]?.galleryImagePaths).toEqual([]);
  });
});
