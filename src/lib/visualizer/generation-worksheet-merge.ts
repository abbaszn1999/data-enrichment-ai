import {
  isNewerRevision,
  isStaleRevision,
  snapshotRevision,
} from "@/lib/jobs/snapshot-clock";
import type {
  VisualizerRow,
  VisualizerRowStatus,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

function isBusyRowStatus(status: VisualizerRowStatus | undefined): boolean {
  return status === "generating";
}

function storedImageCount(row: VisualizerRow): number {
  return (row.imagePlaceholders ?? []).filter((item) => item.storagePath).length;
}

function polledHasNewVisualizerEvidence(
  local: VisualizerRow,
  polled: VisualizerRow
): boolean {
  if (storedImageCount(polled) > storedImageCount(local)) return true;
  const localDesc = local.generatedDescription ?? "";
  const polledDesc = polled.generatedDescription ?? "";
  return polledDesc.length > localDesc.length;
}

export function visualizerRowIsBusy(row: Pick<VisualizerRow, "status">): boolean {
  return isBusyRowStatus(row.status);
}

export function visualizerRunIsActive(
  worksheet: Pick<VisualizerWorksheetJson, "activeRun"> | null | undefined
): boolean {
  const status = worksheet?.activeRun?.status;
  return status === "running" || status === "queued";
}

/**
 * Merge one polled row onto the client copy while generate is in flight.
 * Stale idle/ready snapshots must not wipe optimistic generating UI.
 * A newer revision or new description/images are terminal evidence.
 */
export function mergePolledVisualizerRow(
  local: VisualizerRow,
  polled: VisualizerRow,
  options: { clientRunActive: boolean; polledIsNewer?: boolean }
): VisualizerRow {
  const localBusy = isBusyRowStatus(local.status);
  const polledBusy = isBusyRowStatus(polled.status);

  if (polledBusy) {
    return polled;
  }

  if (localBusy && !polledBusy) {
    if (!options.clientRunActive) {
      return polled;
    }
    if (polled.status === "failed") {
      return polled;
    }
    const polledTerminal =
      polled.status === "images_ready" || polled.status === "description_ready";
    if (options.polledIsNewer && polledTerminal) {
      return polled;
    }
    if (polledTerminal && polledHasNewVisualizerEvidence(local, polled)) {
      return polled;
    }
    // Accept terminal progress once the server has moved past planning/description.
    if (
      polledTerminal &&
      (local.generationStage === "images" ||
        local.generationStage === "finalizing")
    ) {
      return polled;
    }
    if (
      polled.status === "images_ready" &&
      local.generationStage === "description"
    ) {
      return polled;
    }

    return {
      ...polled,
      status: local.status,
      generationStage: local.generationStage,
      errorMessage: local.errorMessage,
      generatedDescription:
        local.generatedDescription ?? polled.generatedDescription,
      imagePlaceholders: local.imagePlaceholders ?? polled.imagePlaceholders,
    };
  }

  return polled;
}

export function mergePolledVisualizerWorksheet(params: {
  local: VisualizerWorksheetJson;
  polled: VisualizerWorksheetJson;
  clientRunActive: boolean;
}): VisualizerWorksheetJson {
  const { local, polled, clientRunActive } = params;
  if (isStaleRevision(polled.revision, local.revision)) {
    return local;
  }
  const polledIsNewer = isNewerRevision(polled.revision, local.revision);
  const localById = new Map(local.rows.map((row) => [row.id, row]));

  const rows = polled.rows.map((polledRow) => {
    const localRow = localById.get(polledRow.id);
    if (!localRow) return polledRow;
    return mergePolledVisualizerRow(localRow, polledRow, {
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

  if (clientRunActive && !polledRunActive && localRunActive && !polledIsNewer) {
    activeRun = local.activeRun ?? activeRun;
  }

  return {
    ...polled,
    rows,
    activeRun,
    revision: Math.max(
      snapshotRevision(polled.revision),
      snapshotRevision(local.revision)
    ),
  };
}

export function adoptIncomingVisualizerWorksheet(
  current: VisualizerWorksheetJson | null,
  incoming: VisualizerWorksheetJson
): VisualizerWorksheetJson {
  if (!current) return incoming;
  if (isStaleRevision(incoming.revision, current.revision)) {
    return current;
  }
  return mergePolledVisualizerWorksheet({
    local: current,
    polled: incoming,
    clientRunActive: false,
  });
}
