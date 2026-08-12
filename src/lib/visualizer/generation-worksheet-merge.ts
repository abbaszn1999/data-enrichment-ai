import type {
  VisualizerRow,
  VisualizerRowStatus,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

function isBusyRowStatus(status: VisualizerRowStatus | undefined): boolean {
  return status === "generating";
}

/**
 * Merge one polled row onto the client copy while generate is in flight.
 * Stale idle/ready snapshots must not wipe optimistic generating UI.
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
    // Accept terminal progress once the server has moved past planning/description.
    if (
      (polled.status === "images_ready" ||
        polled.status === "description_ready") &&
      (local.generationStage === "images" ||
        local.generationStage === "finalizing")
    ) {
      return polled;
    }
    if (
      polled.status === "images_ready" &&
      local.generationStage === "description"
    ) {
      // Unlikely mid-full-run; still take completed images if present.
      return polled;
    }

    return {
      ...polled,
      status: local.status,
      generationStage: local.generationStage,
      errorMessage: local.errorMessage,
      // Keep local description once the client already received it via an earlier poll.
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

  if (clientRunActive && !polledRunActive && localRunActive) {
    activeRun = local.activeRun ?? activeRun;
  }

  return {
    ...polled,
    rows,
    activeRun,
  };
}
