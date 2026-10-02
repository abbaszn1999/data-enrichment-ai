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

export const MAX_WATCHED_ROW_IDS = 100;

/**
 * The delta poll names the rows it is still waiting on. Large runs are split
 * into windows that rotate per poll so every busy row is asked about.
 */
export function rotateWatchedRowIds(
  ids: string[],
  pollIndex: number,
  limit = MAX_WATCHED_ROW_IDS
): string[] {
  if (ids.length <= limit) return ids;
  const windows = Math.ceil(ids.length / limit);
  const start = (Math.max(0, pollIndex) % windows) * limit;
  return ids.slice(start, start + limit);
}

function storedImageSignature(row: VisualizerRow): string {
  return (row.imagePlaceholders ?? [])
    .map((item) => item.storagePath ?? "")
    .join("|");
}

/**
 * While a run is being requested the client still holds the previous results
 * of a regenerated row. A polled snapshot only counts as the new result when
 * it differs from what the client holds; the pre-run snapshot is identical.
 */
function polledIsNewVisualizerResult(
  local: VisualizerRow,
  polled: VisualizerRow
): boolean {
  if ((polled.generatedDescription ?? "") !== (local.generatedDescription ?? "")) {
    return true;
  }
  return storedImageSignature(polled) !== storedImageSignature(local);
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
 * Stale idle/ready snapshots (the pre-run result) must not wipe the optimistic
 * generating UI. Only a failure or a description/images that differ from what
 * the client holds count as the new result. Once the request has returned,
 * storage is authoritative.
 */
export function mergePolledVisualizerRow(
  local: VisualizerRow,
  polled: VisualizerRow,
  options: { clientRunActive: boolean }
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
    if (polledTerminal && polledIsNewVisualizerResult(local, polled)) {
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
    return mergePolledVisualizerRow(localRow, polledRow, { clientRunActive });
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
  // The generate response is a snapshot from the moment the run started. A
  // fast run can already have delivered a finished row through the poll; the
  // snapshot's generating copy of that row must not bring the loading back.
  const currentById = new Map(current.rows.map((row) => [row.id, row]));
  const rows = incoming.rows.map((incomingRow) => {
    const currentRow = currentById.get(incomingRow.id);
    if (
      currentRow &&
      incomingRow.status === "generating" &&
      (currentRow.status === "images_ready" ||
        currentRow.status === "description_ready") &&
      polledIsNewVisualizerResult(incomingRow, currentRow)
    ) {
      return currentRow;
    }
    return incomingRow;
  });
  return mergePolledVisualizerWorksheet({
    local: current,
    polled: { ...incoming, rows },
    clientRunActive: false,
  });
}
