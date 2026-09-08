import { imageRefsMatch } from "@/lib/gallery/image-refs";
import {
  getRowMainImagePaths,
  type GalleryRow,
  type GalleryRowStatus,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";
import {
  isNewerRevision,
  isStaleRevision,
  snapshotRevision,
} from "@/lib/jobs/snapshot-clock";

function isBusyRowStatus(status: GalleryRowStatus | undefined): boolean {
  return status === "queued" || status === "generating";
}

function imagePathCount(row: GalleryRow): number {
  return (
    getRowMainImagePaths(row).length + (row.galleryImagePaths?.length ?? 0)
  );
}

function polledHasNewImageEvidence(local: GalleryRow, polled: GalleryRow): boolean {
  if (imagePathCount(polled) > imagePathCount(local)) return true;
  const localMain = getRowMainImagePaths(local);
  const polledMain = getRowMainImagePaths(polled);
  const localGallery = local.galleryImagePaths ?? [];
  const polledGallery = polled.galleryImagePaths ?? [];
  const hasNew = (next: string[], prev: string[]) =>
    next.some((path) => !prev.some((existing) => imageRefsMatch(existing, path)));
  return hasNew(polledMain, localMain) || hasNew(polledGallery, localGallery);
}

export function galleryRowIsBusy(row: Pick<GalleryRow, "status">): boolean {
  return isBusyRowStatus(row.status);
}

export function galleryRunIsActive(
  worksheet: Pick<GalleryWorksheetJson, "activeRun"> | null | undefined
): boolean {
  const status = worksheet?.activeRun?.status;
  return status === "running" || status === "queued";
}

/**
 * Merge one polled row onto the client copy while a generate request is in
 * flight. Stale idle/ready snapshots must not wipe optimistic queued UI.
 * A newer revision, new image paths, or an explicit failure are terminal
 * evidence and always win — even while POST /generate is still open.
 */
export function mergePolledGenerationRow(
  local: GalleryRow,
  polled: GalleryRow,
  options: { clientRunActive: boolean; polledIsNewer?: boolean }
): GalleryRow {
  const localBusy = isBusyRowStatus(local.status);
  const polledBusy = isBusyRowStatus(polled.status);

  // Live server progress (checkpoints) wins over optimistic local state.
  if (polledBusy) {
    return polled;
  }

  // Local is mid-run but the poll returned a non-busy snapshot.
  if (localBusy && !polledBusy) {
    // After the client request ends, storage is authoritative again.
    if (!options.clientRunActive) {
      return polled;
    }

    if (polled.status === "failed") {
      return polled;
    }
    if (options.polledIsNewer && polled.status === "ready") {
      return polled;
    }
    if (polled.status === "ready" && local.status === "generating") {
      return polled;
    }
    // Fast jobs persist `ready` while the client is still only `queued`.
    // New image paths prove this is not the pre-run snapshot.
    if (polled.status === "ready" && polledHasNewImageEvidence(local, polled)) {
      return polled;
    }

    return {
      ...polled,
      status: local.status,
      generationStage: local.generationStage,
      generationTarget: local.generationTarget ?? polled.generationTarget,
      errorMessage: local.errorMessage,
    };
  }

  return polled;
}

/**
 * Apply a generation poll snapshot without erasing in-flight row loading UI.
 */
export function mergePolledGenerationWorksheet(params: {
  local: GalleryWorksheetJson;
  polled: GalleryWorksheetJson;
  clientRunActive: boolean;
}): GalleryWorksheetJson {
  const { local, polled, clientRunActive } = params;
  if (isStaleRevision(polled.revision, local.revision)) {
    return local;
  }
  const polledIsNewer = isNewerRevision(polled.revision, local.revision);
  const localById = new Map(local.rows.map((row) => [row.id, row]));

  const rows = polled.rows.map((polledRow) => {
    const localRow = localById.get(polledRow.id);
    if (!localRow) return polledRow;
    return mergePolledGenerationRow(localRow, polledRow, {
      clientRunActive,
      polledIsNewer,
    });
  });

  let activeRun = polled.activeRun ?? local.activeRun ?? null;
  const polledRunActive =
    polled.activeRun?.status === "running" ||
    polled.activeRun?.status === "queued";
  const localRunActive =
    local.activeRun?.status === "running" ||
    local.activeRun?.status === "queued";

  // Keep the local activeRun badge while the client request is still open and
  // the poll has not yet observed the run. A newer revision without a live
  // run means the job already finished — do not revive the optimistic badge.
  if (clientRunActive && !polledRunActive && localRunActive && !polledIsNewer) {
    activeRun = local.activeRun ?? activeRun;
  }

  return {
    ...polled,
    rows,
    activeRun,
    revision: Math.max(snapshotRevision(polled.revision), snapshotRevision(local.revision)),
  };
}

/**
 * Apply a generate/PATCH HTTP body without letting a stale 202 wipe a newer
 * poll snapshot (monotonic revision / last-writer with a clock).
 */
export function adoptIncomingGenerationWorksheet(
  current: GalleryWorksheetJson | null,
  incoming: GalleryWorksheetJson
): GalleryWorksheetJson {
  if (!current) return incoming;
  if (isStaleRevision(incoming.revision, current.revision)) {
    return current;
  }
  return mergePolledGenerationWorksheet({
    local: current,
    polled: incoming,
    clientRunActive: false,
  });
}

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
