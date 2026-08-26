import { createAdminClient } from "@/lib/supabase-admin";
import { processDescriptionRow } from "@/lib/visualizer/process-description-row";
import { processImagesRow } from "@/lib/visualizer/process-images-row";
import { loadVisualizerWorksheetAdmin } from "@/lib/visualizer/storage-admin";
import type { VisualizerRow } from "@/lib/visualizer/types";
import { isInsufficientCredits } from "./credits";
import { isJobCancelRequested, loadJobRun } from "./repo";
import type { VisualizerJobSettings } from "./visualizer-settings";

export type VisualizerRowTaskInput = {
  runId: string;
  rowId: string;
};

export type VisualizerRowOutcome = {
  rowId: string;
  row: VisualizerRow;
  creditsUsed: number;
  cost: number;
  failed: boolean;
  imagesStoppedEarly: boolean;
  error?: string;
  noCredits?: boolean;
};

export async function executeVisualizerRow(
  input: VisualizerRowTaskInput
): Promise<VisualizerRowOutcome> {
  const admin = createAdminClient();
  const run = await loadJobRun(admin, input.runId);
  if (!run || run.kind !== "visualizer") {
    return {
      rowId: input.rowId,
      row: {
        id: input.rowId,
        rowIndex: 0,
        originalData: {},
        status: "failed",
        errorMessage: "Job run not found",
      } as VisualizerRow,
      creditsUsed: 0,
      cost: 0,
      failed: true,
      imagesStoppedEarly: false,
      error: "Job run not found",
    };
  }
  const settings = run.settings as VisualizerJobSettings;
  const phase = settings.phase ?? "full";
  const worksheet = await loadVisualizerWorksheetAdmin(
    run.workspace_id,
    run.session_id
  );
  const row = worksheet?.rows.find((candidate) => candidate.id === input.rowId);
  if (!worksheet || !row || !settings.runtimeSettings) {
    return {
      rowId: input.rowId,
      row: {
        ...(row ?? ({ id: input.rowId, rowIndex: 0, originalData: {}, status: "failed" } as VisualizerRow)),
        status: "failed",
        errorMessage: "Row not found",
      },
      creditsUsed: 0,
      cost: 0,
      failed: true,
      imagesStoppedEarly: false,
      error: "Row not found",
    };
  }

  const shared = {
    admin,
    workspaceId: run.workspace_id,
    sessionId: run.session_id,
    worksheet: structuredClone(worksheet),
    ownerUserId: settings.ownerUserId,
    actorUserId: settings.actorUserId,
    runId: settings.visualizerRunId || run.id,
    settings: settings.runtimeSettings,
  };

  let creditsUsed = 0;
  let cost = 0;
  let finalRow = structuredClone(row);
  let failed = false;
  let imagesStoppedEarly = false;
  let error: string | undefined;

  try {
    if (phase === "description" || phase === "full") {
      const descResult = await processDescriptionRow({
        ...shared,
        row: finalRow,
      });
      creditsUsed += descResult.creditsUsed;
      cost += descResult.cost;
      finalRow = descResult.row;
      error = descResult.error;
      if (descResult.row.status !== "description_ready") {
        failed = true;
      } else if (phase === "full") {
        const imageResult = await processImagesRow({
          ...shared,
          row: {
            ...descResult.row,
            status: "generating",
            generationStage: "images",
            imagePlaceholders: (descResult.row.imagePlaceholders ?? []).map(
              (item) => ({ ...item, storagePath: null })
            ),
          },
          shouldCancel: () => isJobCancelRequested(admin, run.id),
        });
        creditsUsed += imageResult.creditsUsed;
        cost += imageResult.cost;
        finalRow = { ...imageResult.row, generationStage: undefined };
        error = imageResult.error || error;
        if (imageResult.row.status === "description_ready") {
          imagesStoppedEarly = true;
        } else if (imageResult.row.status !== "images_ready") {
          failed = true;
        }
      } else {
        finalRow = { ...descResult.row, generationStage: undefined };
      }
    } else {
      const imageResult = await processImagesRow({
        ...shared,
        row: finalRow,
        shouldCancel: () => isJobCancelRequested(admin, run.id),
      });
      creditsUsed += imageResult.creditsUsed;
      cost += imageResult.cost;
      finalRow = { ...imageResult.row, generationStage: undefined };
      error = imageResult.error;
      if (imageResult.row.status === "description_ready") {
        imagesStoppedEarly = true;
      } else if (imageResult.row.status !== "images_ready") {
        failed = true;
      }
    }
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message.slice(0, 500) : "Row processing failed";
    failed = true;
    error = message;
    finalRow = {
      ...row,
      status: "failed",
      generationStage: undefined,
      errorMessage: message,
    };
  }

  return {
    rowId: input.rowId,
    row: finalRow,
    creditsUsed,
    cost,
    failed,
    imagesStoppedEarly,
    error,
    noCredits: isInsufficientCredits(error),
  };
}
