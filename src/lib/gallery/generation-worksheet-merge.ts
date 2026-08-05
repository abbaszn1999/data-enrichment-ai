import { imageRefsMatch } from "@/lib/gallery/image-refs";
import {
  getRowMainImagePaths,
  type GalleryRow,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";

/** Paths present in memory but removed from storage (user delete won). */
export function pathsRemovedByUser(
  memoryPaths: string[],
  storagePaths: string[]
): string[] {
  return memoryPaths.filter(
    (memoryPath) =>
      !storagePaths.some((storagePath) =>
        imageRefsMatch(storagePath, memoryPath)
      )
  );
}

function omitRemovedPaths(paths: string[], removed: string[]): string[] {
  if (removed.length === 0) return [...paths];
  return paths.filter(
    (path) => !removed.some((removedPath) => imageRefsMatch(removedPath, path))
  );
}

/**
 * Fold a generation patch onto the latest storage row without reviving images
 * the user deleted while the run was in flight.
 */
export function applyGenerationRowPatch(params: {
  storageRow: GalleryRow;
  memoryRow: GalleryRow;
  patch: Partial<GalleryRow>;
}): GalleryRow {
  const { storageRow, memoryRow, patch } = params;
  const removedMain = pathsRemovedByUser(
    getRowMainImagePaths(memoryRow),
    getRowMainImagePaths(storageRow)
  );
  const removedGallery = pathsRemovedByUser(
    memoryRow.galleryImagePaths ?? [],
    storageRow.galleryImagePaths ?? []
  );

  const next: GalleryRow = {
    ...storageRow,
    status: patch.status ?? memoryRow.status ?? storageRow.status,
    generationStage:
      patch.generationStage !== undefined
        ? patch.generationStage
        : memoryRow.generationStage,
    generationTarget:
      patch.generationTarget !== undefined
        ? patch.generationTarget
        : memoryRow.generationTarget,
    errorMessage:
      patch.errorMessage !== undefined
        ? patch.errorMessage
        : memoryRow.errorMessage,
    sourceMeta: patch.sourceMeta ?? memoryRow.sourceMeta ?? storageRow.sourceMeta,
    creditsUsed:
      patch.creditsUsed !== undefined
        ? patch.creditsUsed
        : (memoryRow.creditsUsed ?? storageRow.creditsUsed),
    // Cell edits from the user always win over the in-memory generation copy.
    originalData: storageRow.originalData,
  };

  if (patch.mainImagePaths !== undefined || patch.mainImagePath !== undefined) {
    const proposed = Array.isArray(patch.mainImagePaths)
      ? patch.mainImagePaths
      : patch.mainImagePath
        ? [patch.mainImagePath]
        : [];
    const filtered = omitRemovedPaths(proposed, removedMain);
    next.mainImagePaths = filtered;
    next.mainImagePath = filtered[0] ?? null;
  } else {
    const filtered = omitRemovedPaths(
      getRowMainImagePaths(memoryRow),
      removedMain
    );
    next.mainImagePaths = filtered;
    next.mainImagePath = filtered[0] ?? null;
  }

  if (patch.galleryImagePaths !== undefined) {
    next.galleryImagePaths = omitRemovedPaths(
      patch.galleryImagePaths,
      removedGallery
    );
  } else {
    next.galleryImagePaths = omitRemovedPaths(
      memoryRow.galleryImagePaths ?? [],
      removedGallery
    );
  }

  if (patch.sourceMeta?.images && removedMain.length + removedGallery.length > 0) {
    const blocked = [...removedMain, ...removedGallery];
    next.sourceMeta = {
      ...next.sourceMeta,
      images: (patch.sourceMeta.images ?? []).filter((image) => {
        const ref = String(image.ref || image.url || "");
        return !blocked.some((path) => imageRefsMatch(path, ref));
      }),
    };
  }

  return next;
}

/**
 * Rebase the in-memory generation worksheet onto the latest storage snapshot
 * so concurrent user image deletes are never overwritten.
 */
export function reconcileGenerationWorksheet(params: {
  memory: GalleryWorksheetJson;
  storage: GalleryWorksheetJson;
  targetRowIds: ReadonlySet<string>;
}): GalleryWorksheetJson {
  const { memory, storage, targetRowIds } = params;
  const storageById = new Map(storage.rows.map((row) => [row.id, row]));

  return {
    ...storage,
    // Generation owns run progress + runtime settings for this request.
    activeRun: memory.activeRun ?? storage.activeRun,
    settings: memory.settings,
    selectedColumns: memory.selectedColumns,
    originalImageColumn: memory.originalImageColumn,
    originalImageSelectionExplicit: memory.originalImageSelectionExplicit,
    revision: storage.revision ?? memory.revision,
    rows: memory.rows.map((memoryRow) => {
      const storageRow = storageById.get(memoryRow.id);
      if (!storageRow) return memoryRow;

      const isTarget = targetRowIds.has(memoryRow.id);
      const isBusy =
        memoryRow.status === "generating" || memoryRow.status === "queued";

      // Rows the run is not touching: storage is authoritative (user edits).
      if (!isTarget && !isBusy) {
        return storageRow;
      }

      return applyGenerationRowPatch({
        storageRow,
        memoryRow,
        patch: {},
      });
    }),
  };
}
