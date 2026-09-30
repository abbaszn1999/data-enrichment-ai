import { createAdminClient } from "@/lib/supabase-admin";
import { visualizerRowStoreEnabled } from "@/lib/catalog/flag";
import { upsertWorksheetRow } from "@/lib/worksheet-rows/store";
import { processDescriptionRow } from "@/lib/visualizer/process-description-row";
import { processImagesRow } from "@/lib/visualizer/process-images-row";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import { loadVisualizerWorksheetAdmin } from "@/lib/visualizer/storage-admin";
import type { VisualizerProjectSettings, VisualizerRow } from "@/lib/visualizer/types";
import { isInsufficientCredits } from "./credits";
import { loadJobRun } from "./repo";
import { isVisualizerCancelled } from "./visualizer-cancel";
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

/** Time a row task may use: the visualizerRow task timeout (1500s) minus a margin for billing and cleanup. */
export const VISUALIZER_ROW_DEADLINE_MS = 1_380_000;

/**
 * A row task needs only its own row plus the run's frozen settings. Loading the
 * whole worksheet (blob + every row of a large sheet) for each child task would
 * multiply the reads by the row count, so the row comes straight from the row
 * store. Returns null when that is not possible (row store off, row missing)
 * and the caller falls back to the full load.
 */
export async function loadVisualizerRowContext(params: {
  admin: ReturnType<typeof createAdminClient>;
  sessionId: string;
  rowId: string;
  jobSettings: VisualizerJobSettings;
}): Promise<{ row: VisualizerRow; settings: VisualizerProjectSettings } | null> {
  if (!visualizerRowStoreEnabled() || !params.jobSettings.runtimeSettings) return null;
  const { data, error } = await params.admin
    .from("visualizer_session_rows")
    .select("row_id, row_index, status, data")
    .eq("session_id", params.sessionId)
    .eq("row_id", params.rowId)
    .maybeSingle();
  if (error || !data) return null;
  const payload = (data.data ?? {}) as Partial<VisualizerRow>;
  if (!payload.originalData || typeof payload.originalData !== "object") return null;
  const row: VisualizerRow = {
    ...(payload as VisualizerRow),
    id: data.row_id as string,
    rowIndex: Number(data.row_index ?? 0),
    status: data.status as VisualizerRow["status"],
  };
  return { row, settings: parseVisualizerProjectSettings(params.jobSettings.runtimeSettings) };
}

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
  const jobSettings = run.settings as VisualizerJobSettings;
  const phase = jobSettings.phase ?? "full";

  let row: VisualizerRow | undefined;
  let settings: VisualizerProjectSettings | undefined;
  const single = await loadVisualizerRowContext({
    admin,
    sessionId: run.session_id,
    rowId: input.rowId,
    jobSettings,
  });
  if (single) {
    row = single.row;
    settings = single.settings;
  } else if (jobSettings.runtimeSettings) {
    const worksheet = await loadVisualizerWorksheetAdmin(run.workspace_id, run.session_id);
    row = worksheet?.rows.find((candidate) => candidate.id === input.rowId);
    settings = parseVisualizerProjectSettings(jobSettings.runtimeSettings);
  }
  if (!row || !settings) {
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

  const startedAt = Date.now();
  const rowState: VisualizerRow = structuredClone(row);
  // Each checkpoint writes the row to the row store, so a client that left the
  // page and came back sees the description and every finished image.
  const storeCheckpoint = async (patch: Partial<VisualizerRow>) => {
    if (!visualizerRowStoreEnabled()) return;
    Object.assign(rowState, patch, { status: "generating" as const });
    await upsertWorksheetRow(admin, "visualizer_session_rows", run.session_id, rowState);
  };
  const shared = {
    admin,
    workspaceId: run.workspace_id,
    sessionId: run.session_id,
    ownerUserId: jobSettings.ownerUserId,
    actorUserId: jobSettings.actorUserId,
    runId: jobSettings.visualizerRunId || run.id,
    settings,
    deadlineAt: startedAt + VISUALIZER_ROW_DEADLINE_MS,
    shouldCancel: () => isVisualizerCancelled(admin, run.id, run.session_id, run.workspace_id),
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
        const withImages: VisualizerRow = {
          ...descResult.row,
          status: "generating",
          generationStage: "images",
          imagePlaceholders: (descResult.row.imagePlaceholders ?? []).map((item) => ({
            ...item,
            storagePath: null,
          })),
        };
        // The paid description is saved before the first image starts.
        await storeCheckpoint({
          generatedDescription: withImages.generatedDescription,
          imagePlaceholders: withImages.imagePlaceholders,
          generationStage: "images",
        }).catch(() => undefined);
        const imageResult = await processImagesRow({
          ...shared,
          row: withImages,
          onCheckpoint: storeCheckpoint,
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
        onCheckpoint: storeCheckpoint,
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
