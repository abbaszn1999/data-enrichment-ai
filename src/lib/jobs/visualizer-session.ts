import { createAdminClient } from "@/lib/supabase-admin";
import {
  loadVisualizerWorksheetAdmin,
  loadVisualizerWorksheetMatchingRevisionAdmin,
  saveVisualizerResultsAdmin,
  saveVisualizerWorksheetAdmin,
  signVisualizerWorksheetImages,
} from "@/lib/visualizer/storage-admin";
import { withVisualizerWorksheetLock } from "@/lib/visualizer/worksheet-lock";
import { visualizerError, visualizerLog, visualizerWarn } from "@/lib/visualizer/log";
import type {
  VisualizerPhase,
  VisualizerRow,
  VisualizerRowStatus,
  VisualizerSession,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";
import { JOB_BATCH_SIZE } from "./config";
import { isInsufficientCredits } from "./credits";
import { executeVisualizerRow, type VisualizerRowOutcome } from "./visualizer-row";
import type { VisualizerJobSettings } from "./visualizer-settings";
import { runJobWithFailureGuard } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  isJobCancelRequested,
  loadJobRun,
  markJobRunning,
  touchJobHeartbeat,
} from "./repo";

function rowCounts(worksheet: VisualizerWorksheetJson) {
  return {
    ready: worksheet.rows.filter(
      (row) =>
        row.status === "description_ready" || row.status === "images_ready"
    ).length,
    failed: worksheet.rows.filter((row) => row.status === "failed").length,
  };
}

export async function runVisualizerSession(
  runId: string,
  options?: { processRow?: (rowId: string) => Promise<VisualizerRowOutcome> }
): Promise<void> {
  await runJobWithFailureGuard(runId, () =>
    runVisualizerSessionInner(runId, options)
  );
}

async function runVisualizerSessionInner(
  runId: string,
  options?: { processRow?: (rowId: string) => Promise<VisualizerRowOutcome> }
): Promise<void> {
  const admin = createAdminClient();
  const run = await loadJobRun(admin, runId);
  if (!run || run.kind !== "visualizer") return;
  if (run.status === "cancelled") return;

  await markJobRunning(admin, run.id);
  const settings = run.settings as VisualizerJobSettings;
  const workspaceId = run.workspace_id;
  const sessionId = run.session_id;
  const phase: VisualizerPhase = settings.phase ?? "full";
  const targetIds = settings.targetIds?.length ? settings.targetIds : run.target_ids;
  const previousStatus = new Map<string, VisualizerRowStatus>(
    Object.entries(settings.previousStatus ?? {}) as Array<[string, VisualizerRowStatus]>
  );
  const runtimeSettings = settings.runtimeSettings;

  let worksheet = await loadVisualizerWorksheetAdmin(workspaceId, sessionId);
  if (!worksheet || !runtimeSettings) {
    const failed = await finishJobRun(admin, run.id, {
      status: "failed",
      completedCount: 0,
      failedCount: targetIds.length,
      lastError: "Worksheet or settings not found",
    });
    if (failed) await notifyJobEvent(failed, "failed", admin);
    return;
  }

  let completed = worksheet.activeRun?.completed ?? 0;
  let failed = worksheet.activeRun?.failed ?? 0;
  let usedCredits = worksheet.activeRun?.usedCredits ?? 0;
  let usedCost = 0;
  let cancelled = false;
  let pausedNoCredits = false;
  let worksheetWriteQueue: Promise<void> = Promise.resolve();
  let expectedRevision = Number(worksheet.revision ?? 0);

  const persistRevision = async () => {
    const { data: claimedRevision, error } = await admin.rpc(
      "claim_visualizer_worksheet_revision",
      {
        p_session_id: sessionId,
        p_workspace_id: workspaceId,
        p_expected_revision: expectedRevision,
      }
    );
    if (error) throw error;
    if (claimedRevision === null || claimedRevision === undefined) {
      const stored = await loadVisualizerWorksheetMatchingRevisionAdmin(
        workspaceId,
        sessionId,
        expectedRevision
      );
      if (stored) {
        const byId = new Map(worksheet!.rows.map((row) => [row.id, row]));
        worksheet = {
          ...stored,
          settings: worksheet!.settings,
          activeRun: worksheet!.activeRun,
          rows: stored.rows.map((row) => byId.get(row.id) ?? row),
        };
      }
      const { data: latest } = await admin
        .from("visualizer_sessions")
        .select("worksheet_revision")
        .eq("id", sessionId)
        .eq("workspace_id", workspaceId)
        .single();
      expectedRevision = Number(latest?.worksheet_revision ?? expectedRevision);
      const { data: retryRevision, error: retryError } = await admin.rpc(
        "claim_visualizer_worksheet_revision",
        {
          p_session_id: sessionId,
          p_workspace_id: workspaceId,
          p_expected_revision: expectedRevision,
        }
      );
      if (retryError) throw retryError;
      if (retryRevision === null || retryRevision === undefined) {
        throw new Error("WORKSHEET_REVISION_CONFLICT");
      }
      expectedRevision = Number(retryRevision);
    } else {
      expectedRevision = Number(claimedRevision);
    }
    worksheet!.revision = expectedRevision;
    await saveVisualizerWorksheetAdmin(
      workspaceId,
      sessionId,
      worksheet!,
      expectedRevision
    );
  };

  const commitWorksheet = (mutate: () => void | Promise<void>): Promise<void> => {
    const operation = worksheetWriteQueue.then(async () => {
      await withVisualizerWorksheetLock(workspaceId, sessionId, async () => {
        await mutate();
        await persistRevision();
      });
    });
    worksheetWriteQueue = operation.catch(() => undefined);
    return operation;
  };

  const cancellationRequested = async () => {
    if (await isJobCancelRequested(admin, run.id)) return true;
    const { data, error } = await admin
      .from("visualizer_sessions")
      .select("cancel_requested")
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId)
      .single();
    if (error) throw error;
    return Boolean(data?.cancel_requested);
  };

  const writeResults = async (options?: { signImages?: boolean }) => {
    try {
      const shouldSign =
        (phase === "images" || phase === "full") && options?.signImages !== false;
      const signed = shouldSign
        ? await signVisualizerWorksheetImages(worksheet!, 60 * 60 * 24 * 7).catch(
            (error) => {
              visualizerWarn(
                "visualizer-session:results",
                "Could not sign images for results.xlsx",
                { error: error instanceof Error ? error.message : String(error) }
              );
              return {} as Record<string, string>;
            }
          )
        : {};
      await saveVisualizerResultsAdmin(workspaceId, sessionId, worksheet!, signed);
    } catch (resultsError) {
      visualizerError("visualizer-session:results", "Failed to update results.xlsx", resultsError);
    }
  };

  visualizerLog("visualizer-session", `Starting ${phase} phase`, {
    sessionId,
    runId: run.id,
    rowCount: targetIds.length,
  });

  const remainingIds = targetIds.filter((id) => {
    const row = worksheet!.rows.find((r) => r.id === id);
    if (!row) return false;
    if (row.status === "images_ready") return false;
    if (phase === "description" && row.status === "description_ready") return false;
    return true;
  });

  let nextTargetIndex = 0;
  let stopObserved = false;
  const worker = async () => {
    while (true) {
      if (stopObserved || (await cancellationRequested())) {
        stopObserved = true;
        cancelled = true;
        return;
      }
      const targetIndex = nextTargetIndex;
      nextTargetIndex += 1;
      if (targetIndex >= remainingIds.length) return;
      const rowId = remainingIds[targetIndex]!;

      let claimedRow: VisualizerRow | null = null;
      await commitWorksheet(() => {
        const index = worksheet!.rows.findIndex((row) => row.id === rowId);
        if (index < 0) {
          claimedRow = null;
          return;
        }
        worksheet!.rows[index] = {
          ...worksheet!.rows[index]!,
          status: "generating",
          generationStage: phase === "images" ? "images" : "description",
          errorMessage: undefined,
        };
        if (worksheet!.activeRun) {
          worksheet!.activeRun.currentRowId = rowId;
          worksheet!.activeRun.updatedAt = new Date().toISOString();
        }
        claimedRow = structuredClone(worksheet!.rows[index]!) as VisualizerRow;
      });
      if (!claimedRow) continue;
      const inputRow: VisualizerRow = claimedRow;

      const outcome = options?.processRow
        ? await options.processRow(rowId)
        : await executeVisualizerRow({ runId: run.id, rowId });
      let rowCredits = outcome.creditsUsed;
      let rowCost = outcome.cost;
      let finalRow: VisualizerRow = outcome.row;
      let rowFailed = outcome.failed;
      const imagesStoppedEarly = outcome.imagesStoppedEarly;

      if (outcome.noCredits || isInsufficientCredits(outcome.error)) {
        pausedNoCredits = true;
        stopObserved = true;
        const previous = previousStatus.get(rowId);
        finalRow = {
          ...inputRow,
          status: previous && previous !== "generating" ? previous : "not_started",
          generationStage: undefined,
          errorMessage: "Paused — out of credits",
        };
        rowFailed = false;
        rowCredits = 0;
        rowCost = 0;
      }

      await commitWorksheet(() => {
        const index = worksheet!.rows.findIndex((row) => row.id === rowId);
        if (index >= 0) worksheet!.rows[index] = finalRow;
        if (
          finalRow.status === "images_ready" ||
          (phase === "description" && finalRow.status === "description_ready")
        ) {
          completed += 1;
          usedCredits += rowCredits;
          usedCost += rowCost;
        } else if (imagesStoppedEarly) {
          usedCredits += rowCredits;
          usedCost += rowCost;
        } else if (rowFailed || finalRow.status === "failed") {
          failed += 1;
          usedCredits += rowCredits;
          usedCost += rowCost;
        } else {
          usedCredits += rowCredits;
          usedCost += rowCost;
        }
        if (worksheet!.activeRun) {
          worksheet!.activeRun.completed = completed;
          worksheet!.activeRun.failed = failed;
          worksheet!.activeRun.usedCredits = usedCredits;
          worksheet!.activeRun.updatedAt = new Date().toISOString();
        }
      });
      await writeResults({ signImages: false });
      await touchJobHeartbeat(admin, run.id, { completed, failed });

      if (pausedNoCredits) return;
      if (await cancellationRequested()) {
        stopObserved = true;
        cancelled = true;
        return;
      }
    }
  };

  const workerCount = Math.min(JOB_BATCH_SIZE, remainingIds.length || 1);
  if (remainingIds.length > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }
  await worksheetWriteQueue.catch(() => undefined);

  const markRunCancelled = () => {
    if (!worksheet!.activeRun) return;
    worksheet!.activeRun.cancelRequested = true;
    worksheet!.activeRun.status = "cancelled";
    worksheet!.activeRun.finishedAt = new Date().toISOString();
    worksheet!.activeRun.currentRowId = null;
  };

  const counts = rowCounts(worksheet);
  let finalStatus: VisualizerSession["status"] = "paused";
  let awaiting = true;
  let errorMessage: string | null = null;

  if (pausedNoCredits) {
    if (worksheet.activeRun) {
      worksheet.activeRun.status = "failed";
      worksheet.activeRun.finishedAt = new Date().toISOString();
      worksheet.activeRun.currentRowId = null;
      worksheet.activeRun.errorMessage = "Out of credits";
    }
    finalStatus = "paused";
    awaiting = true;
    errorMessage = "Out of credits";
  } else if (cancelled || (stopObserved && !pausedNoCredits) || (await cancellationRequested())) {
    cancelled = true;
    markRunCancelled();
    if (phase === "images" || phase === "full") {
      const anyImagesReady = worksheet.rows.some((row) => row.status === "images_ready");
      finalStatus = anyImagesReady ? "completed" : "paused";
      awaiting = !anyImagesReady;
    } else {
      finalStatus = completed > 0 ? "paused" : "ready";
      awaiting = completed > 0;
    }
  } else if (completed === 0 && failed > 0) {
    if (worksheet.activeRun) {
      worksheet.activeRun.status = "failed";
      worksheet.activeRun.finishedAt = new Date().toISOString();
      worksheet.activeRun.currentRowId = null;
      worksheet.activeRun.errorMessage = "All selected rows failed";
    }
    finalStatus = "failed";
    awaiting = false;
    errorMessage = "All selected rows failed";
  } else if (phase === "images" || phase === "full") {
    if (worksheet.activeRun) {
      worksheet.activeRun.status = "completed";
      worksheet.activeRun.finishedAt = new Date().toISOString();
      worksheet.activeRun.currentRowId = null;
    }
    finalStatus = "completed";
    awaiting = false;
  } else {
    if (worksheet.activeRun) {
      worksheet.activeRun.status = "completed";
      worksheet.activeRun.finishedAt = new Date().toISOString();
      worksheet.activeRun.currentRowId = null;
    }
    finalStatus = "paused";
    awaiting = true;
  }

  for (const row of worksheet.rows) {
    if (row.status === "generating") {
      const previous = previousStatus.get(row.id);
      row.status = previous && previous !== "generating" ? previous : "not_started";
      row.generationStage = undefined;
    }
  }

  await persistRevision();
  await writeResults();

  await admin.rpc("add_visualizer_session_usage", {
    p_session_id: sessionId,
    p_workspace_id: workspaceId,
    p_credits: usedCredits,
    p_cost: usedCost,
    p_ready_rows: counts.ready,
    p_failed_rows: counts.failed,
    p_status: finalStatus,
    p_error_message: errorMessage,
    p_awaiting_user_action: awaiting,
    p_active_phase:
      finalStatus === "paused"
        ? "description"
        : finalStatus === "completed"
          ? "images"
          : phase === "full"
            ? "images"
            : phase,
  });

  await admin
    .from("visualizer_sessions")
    .update({ cancel_requested: false })
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId);

  const jobStatus =
    pausedNoCredits
      ? "paused_no_credits"
      : cancelled
        ? "cancelled"
        : finalStatus === "failed"
          ? "failed"
          : "completed";
  const finished = await finishJobRun(admin, run.id, {
    status: jobStatus,
    completedCount: completed,
    failedCount: failed,
    lastError: errorMessage,
  });
  if (finished && jobStatus !== "cancelled") {
    await notifyJobEvent(
      finished,
      jobStatus === "failed"
        ? "failed"
        : jobStatus === "paused_no_credits"
          ? "paused_no_credits"
          : "completed",
      admin
    );
  }
}
