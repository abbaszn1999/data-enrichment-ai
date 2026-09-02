import { describe, expect, it } from "vitest";
import {
  adoptIncomingGenerationWorksheet,
  applyGenerationRowPatch,
  mergePolledGenerationRow,
  mergePolledGenerationWorksheet,
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

  it("keeps optimistic queued UI when a poll returns a stale idle row", () => {
    const local = row({
      id: "row-a",
      status: "queued",
      generationStage: "planning",
      generationTarget: "main",
    });
    const polled = row({
      id: "row-a",
      status: "not_started",
    });

    const merged = mergePolledGenerationRow(local, polled, {
      clientRunActive: true,
    });

    expect(merged.status).toBe("queued");
    expect(merged.generationStage).toBe("planning");
    expect(merged.generationTarget).toBe("main");
  });

  it("keeps optimistic queued UI when a poll returns a stale prior ready row", () => {
    const local = row({
      id: "row-a",
      status: "queued",
      generationStage: "planning",
      generationTarget: "main",
      mainImagePaths: ["old.webp"],
      mainImagePath: "old.webp",
    });
    const polled = row({
      id: "row-a",
      status: "ready",
      mainImagePaths: ["old.webp"],
      mainImagePath: "old.webp",
    });

    const merged = mergePolledGenerationRow(local, polled, {
      clientRunActive: true,
    });

    expect(merged.status).toBe("queued");
    expect(merged.generationStage).toBe("planning");
  });

  it("prefers live server generating progress over local queued", () => {
    const local = row({
      id: "row-a",
      status: "queued",
      generationStage: "planning",
      generationTarget: "main",
    });
    const polled = row({
      id: "row-a",
      status: "generating",
      generationStage: "searching",
      generationTarget: "main",
    });

    const merged = mergePolledGenerationRow(local, polled, {
      clientRunActive: true,
    });

    expect(merged.status).toBe("generating");
    expect(merged.generationStage).toBe("searching");
  });

  it("takes terminal server results after the row was already generating", () => {
    const local = row({
      id: "row-a",
      status: "generating",
      generationStage: "searching",
      generationTarget: "main",
    });
    const polled = row({
      id: "row-a",
      status: "ready",
      mainImagePaths: ["https://cdn.example/main.png"],
      mainImagePath: "https://cdn.example/main.png",
    });

    const merged = mergePolledGenerationRow(local, polled, {
      clientRunActive: true,
    });

    expect(merged.status).toBe("ready");
    expect(merged.mainImagePaths).toEqual(["https://cdn.example/main.png"]);
  });

  it("preserves local activeRun when the poll has not observed it yet", () => {
    const local = sheet([
      row({
        id: "row-a",
        status: "queued",
        generationStage: "planning",
        generationTarget: "main",
      }),
    ]);
    const polled = sheet([
      row({
        id: "row-a",
        status: "not_started",
      }),
    ]);
    polled.activeRun = null;

    const merged = mergePolledGenerationWorksheet({
      local,
      polled,
      clientRunActive: true,
    });

    expect(merged.activeRun?.status).toBe("running");
    expect(merged.rows[0]?.status).toBe("queued");
    expect(merged.rows[0]?.generationStage).toBe("planning");
  });

  it("takes queued→ready when the poll has new gallery images", () => {
    const local = row({
      id: "row-a",
      status: "queued",
      generationStage: "planning",
      generationTarget: "gallery",
      galleryImagePaths: [],
    });
    const polled = row({
      id: "row-a",
      status: "ready",
      galleryImagePaths: ["https://cdn.example/gallery-1.webp"],
    });

    const merged = mergePolledGenerationRow(local, polled, {
      clientRunActive: true,
    });

    expect(merged.status).toBe("ready");
    expect(merged.galleryImagePaths).toEqual([
      "https://cdn.example/gallery-1.webp",
    ]);
  });

  it("takes ready from a newer worksheet revision while generate is in flight", () => {
    const local = sheet([
      row({
        id: "row-a",
        status: "queued",
        generationStage: "planning",
        generationTarget: "gallery",
      }),
    ]);
    local.revision = 4;
    const polled = sheet([
      row({
        id: "row-a",
        status: "ready",
        galleryImagePaths: ["https://cdn.example/g1.webp"],
      }),
    ]);
    polled.revision = 5;
    polled.activeRun = {
      ...polled.activeRun!,
      status: "completed",
      completed: 1,
    };

    const merged = mergePolledGenerationWorksheet({
      local,
      polled,
      clientRunActive: true,
    });

    expect(merged.rows[0]?.status).toBe("ready");
    expect(merged.activeRun?.status).toBe("completed");
    expect(merged.revision).toBe(5);
  });

  it("ignores a stale generate 202 that is older than the polled worksheet", () => {
    const current = sheet([
      row({
        id: "row-a",
        status: "ready",
        galleryImagePaths: ["https://cdn.example/g1.webp"],
      }),
    ]);
    current.revision = 6;
    current.activeRun = {
      ...current.activeRun!,
      status: "completed",
      completed: 1,
    };
    const incoming = sheet([
      row({
        id: "row-a",
        status: "queued",
        generationStage: "planning",
        generationTarget: "gallery",
      }),
    ]);
    incoming.revision = 5;

    const adopted = adoptIncomingGenerationWorksheet(current, incoming);

    expect(adopted.revision).toBe(6);
    expect(adopted.rows[0]?.status).toBe("ready");
    expect(adopted.rows[0]?.galleryImagePaths).toEqual([
      "https://cdn.example/g1.webp",
    ]);
  });

  it("keeps the local worksheet when the poll snapshot is an older revision", () => {
    const local = sheet([
      row({
        id: "row-a",
        status: "ready",
        galleryImagePaths: ["https://cdn.example/g1.webp"],
      }),
    ]);
    local.revision = 6;
    const polled = sheet([
      row({
        id: "row-a",
        status: "queued",
        generationStage: "planning",
        generationTarget: "gallery",
      }),
    ]);
    polled.revision = 5;

    const merged = mergePolledGenerationWorksheet({
      local,
      polled,
      clientRunActive: true,
    });

    expect(merged).toBe(local);
  });
});
