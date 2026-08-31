import { createAdminClient } from "@/lib/supabase-admin";
import {
  loadGalleryWorksheetAdmin,
  loadGalleryWorksheetMatchingRevisionAdmin,
  saveGalleryWorksheetAdmin,
} from "@/lib/gallery/storage-admin";
import { applyGenerationRowPatch } from "@/lib/gallery/generation-worksheet-merge";
import type { GalleryWorksheetJson } from "@/lib/gallery/types";
import { galleryError, galleryLog } from "@/lib/gallery/log";
import { withGalleryWorksheetLock } from "@/lib/gallery/worksheet-lock";
import { JOB_BATCH_SIZE } from "./config";
import {
  executeGalleryRow,
  type GalleryRowOutcome,
} from "./gallery-row";
import type { GalleryJobSettings } from "./gallery-settings";
import { runJobWithFailureGuard } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  isJobCancelRequested,
  loadJobRun,
  markJobRunning,
  touchJobHeartbeat,
} from "./repo";

type Admin = ReturnType<typeof createAdminClient>;

function counts(worksheet: GalleryWorksheetJson) {
  return {
    ready: worksheet.rows.filter((row) => row.status === "ready").length,
    failed: worksheet.rows.filter((row) => row.status === "failed").length,
  };
}

export async function runGallerySession(
  runId: string,
  options?: { processRow?: (rowId: string) => Promise<GalleryRowOutcome> }
): Promise<void> {
  await runJobWithFailureGuard(runId, () => runGallerySessionInner(runId, options));
}

async function runGallerySessionInner(
  runId: string,
  options?: { processRow?: (rowId: string) => Promise<GalleryRowOutcome> }
): Promise<void> {
  const admin = createAdminClient();
  const run = await loadJobRun(admin, runId);
  if (!run || run.kind !== "gallery") return;
  if (run.status === "cancelled") return;

  await markJobRunning(admin, run.id);
  const settings = run.settings as GalleryJobSettings;
  const workspaceId = run.workspace_id;
  const sessionId = run.session_id;
  const targetIds = settings.targetIds?.length ? settings.targetIds : run.target_ids;
  const previousStatus = settings.previousStatus ?? {};

  const worksheet = await loadGalleryWorksheetAdmin(workspaceId, sessionId);
  if (!worksheet) {
    const failed = await finishJobRun(admin, run.id, {
      status: "failed",
      completedCount: 0,
      failedCount: targetIds.length,
      lastError: "Worksheet not found",
    });
    if (failed) await notifyJobEvent(failed, "failed", admin);
    return;
  }

  let completed = worksheet.activeRun?.completed ?? 0;
  let failed = worksheet.activeRun?.failed ?? 0;
  let usedCredits = worksheet.activeRun?.usedCredits ?? 0;
  let usedCost = 0;
  let pausedNoCredits = false;
  let stopObserved = false;

  const persist = async () => {
    await persistGalleryWorksheet(admin, workspaceId, sessionId, worksheet!);
  };

  // Serialize every worksheet mutation through one queue so concurrent rows
  // never race on the in-memory object or the storage revision.
  let writeQueue: Promise<void> = Promise.resolve();
  const commitWorksheet = (mutate: () => void): Promise<void> => {
    const operation = writeQueue.then(async () => {
      await withGalleryWorksheetLock(workspaceId, sessionId, async () => {
        mutate();
        await persist();
      });
    });
    writeQueue = operation.catch(() => undefined);
    return operation;
  };

  const remainingIds = targetIds.filter((id) => {
    const row = worksheet!.rows.find((candidate) => candidate.id === id);
    return row && row.status !== "ready" && row.status !== "failed";
  });

  const processRow =
    options?.processRow ??
    ((rowId: string) => executeGalleryRow({ runId: run.id, rowId }));

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      if (stopObserved) return;
      if (await isGalleryCancelled(admin, run.id, sessionId, workspaceId)) {
        stopObserved = true;
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= remainingIds.length) return;
      const rowId = remainingIds[index]!;

      await commitWorksheet(() => {
        const rowIndex = worksheet!.rows.findIndex((row) => row.id === rowId);
        if (rowIndex < 0) return;
        worksheet!.rows[rowIndex] = applyGenerationRowPatch({
          storageRow: worksheet!.rows[rowIndex],
          memoryRow: worksheet!.rows[rowIndex],
          patch: {
            status: "generating",
            generationStage: "planning",
            generationTarget: settings.targetPhases?.[rowId],
            errorMessage: undefined,
          },
        });
      });

      const outcome: GalleryRowOutcome = await processRow(rowId);

      await commitWorksheet(() => {
        const rowIndex = worksheet!.rows.findIndex((row) => row.id === outcome.rowId);
        if (rowIndex < 0) return;
        if (outcome.noCredits) {
          pausedNoCredits = true;
          stopObserved = true;
          const previous = previousStatus[outcome.rowId];
          worksheet!.rows[rowIndex] = applyGenerationRowPatch({
            storageRow: worksheet!.rows[rowIndex],
            memoryRow: worksheet!.rows[rowIndex],
            patch: {
              status: previous && previous !== "generating" ? previous : "not_started",
              generationStage: undefined,
              generationTarget: undefined,
              errorMessage: "Paused — out of credits",
            },
          });
          return;
        }
        worksheet!.rows[rowIndex] = applyGenerationRowPatch({
          storageRow: worksheet!.rows[rowIndex],
          memoryRow: worksheet!.rows[rowIndex],
          patch: {
            status: outcome.status,
            generationStage: undefined,
            generationTarget: undefined,
            errorMessage: outcome.errorMessage,
            mainImagePaths: outcome.mainImagePaths,
            mainImagePath: outcome.mainImagePath,
            galleryImagePaths: outcome.galleryImagePaths,
            sourceMeta: outcome.sourceMeta,
            creditsUsed: outcome.creditsUsed,
          },
        });
        usedCredits += outcome.creditsUsed;
        usedCost += outcome.cost;
        if (outcome.status === "ready") completed += 1;
        else if (!outcome.noCredits) failed += 1;

        if (worksheet!.activeRun) {
          worksheet!.activeRun.completed = completed;
          worksheet!.activeRun.failed = failed;
          worksheet!.activeRun.usedCredits = usedCredits;
        }
      });

      // Heartbeat + counts land in job_runs immediately after each row so
      // polling/Realtime clients see progress in near real time, not once
      // per JOB_BATCH_SIZE-row batch.
      await touchJobHeartbeat(admin, run.id, { completed, failed });

      if (pausedNoCredits) return;
    }
  };

  const workerCount = Math.min(JOB_BATCH_SIZE, remainingIds.length || 1);
  if (remainingIds.length > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }
  await writeQueue.catch(() => undefined);

  const cancelled = await isGalleryCancelled(admin, run.id, sessionId, workspaceId);
  if (cancelled) markRunCancelled(worksheet, targetIds);
  else if (pausedNoCredits && worksheet.activeRun) {
    worksheet.activeRun.status = "failed";
    worksheet.activeRun.finishedAt = new Date().toISOString();
  } else if (worksheet.activeRun?.status !== "cancelled") {
    worksheet.activeRun!.status = "completed";
    worksheet.activeRun!.finishedAt = new Date().toISOString();
  }

  for (const row of worksheet.rows) {
    if (!targetIds.includes(row.id)) continue;
    if (row.status === "queued" || row.status === "generating") {
      row.status =
        previousStatus[row.id] && previousStatus[row.id] !== "generating"
          ? previousStatus[row.id]
          : "not_started";
    }
    row.generationStage = undefined;
    row.generationTarget = undefined;
  }
  await persist();

  const totals = counts(worksheet);
  const finalStatus =
    cancelled
      ? "ready"
      : pausedNoCredits
        ? "ready"
        : totals.ready === worksheet.rows.length
          ? "completed"
          : totals.ready === 0 && totals.failed > 0
            ? "failed"
            : "ready";

  const { error: usageError } = await admin.rpc("add_gallery_session_usage", {
    p_session_id: sessionId,
    p_workspace_id: workspaceId,
    p_credits: usedCredits,
    p_cost: usedCost,
    p_ready_rows: totals.ready,
    p_failed_rows: totals.failed,
    p_status: finalStatus,
    p_error_message:
      pausedNoCredits
        ? "Out of credits"
        : finalStatus === "failed"
          ? "All processed rows failed"
          : null,
  });
  if (usageError) {
    galleryError("gallery-session", "usage rpc failed", usageError);
  }
  await admin
    .from("gallery_sessions")
    .update({ cancel_requested: false })
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId);

  galleryLog("gallery-session:done", "Background gallery run finished", {
    runId: run.id,
    completed,
    failed,
    usedCredits,
    finalStatus,
    pausedNoCredits,
  });

  const jobStatus = cancelled
    ? "cancelled"
    : pausedNoCredits
      ? "paused_no_credits"
      : finalStatus === "failed"
        ? "failed"
        : "completed";
  const finished = await finishJobRun(admin, run.id, {
    status: jobStatus,
    completedCount: completed,
    failedCount: failed,
    lastError:
      jobStatus === "paused_no_credits"
        ? "Out of credits"
        : jobStatus === "failed"
          ? "All processed rows failed"
          : null,
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

function markRunCancelled(worksheet: GalleryWorksheetJson, targetIds: string[]) {
  if (!worksheet.activeRun) return;
  worksheet.activeRun.cancelRequested = true;
  worksheet.activeRun.status = "cancelled";
  worksheet.activeRun.finishedAt = new Date().toISOString();
  for (const row of worksheet.rows) {
    if (targetIds.includes(row.id) && (row.status === "queued" || row.status === "generating")) {
      row.status = "not_started";
      row.generationStage = undefined;
      row.generationTarget = undefined;
    }
  }
}

async function isGalleryCancelled(
  admin: Admin,
  runId: string,
  sessionId: string,
  workspaceId: string
): Promise<boolean> {
  if (await isJobCancelRequested(admin, runId)) return true;
  const { data, error } = await admin
    .from("gallery_sessions")
    .select("cancel_requested")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error) throw error;
  return Boolean(data?.cancel_requested);
}

async function persistGalleryWorksheet(
  admin: Admin,
  workspaceId: string,
  sessionId: string,
  worksheet: GalleryWorksheetJson
): Promise<void> {
  let attemptRevision = Number(worksheet.revision ?? 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: nextRevision, error: revisionError } = await admin.rpc(
      "claim_gallery_worksheet_revision",
      {
        p_session_id: sessionId,
        p_workspace_id: workspaceId,
        p_expected_revision: attemptRevision,
      }
    );
    if (revisionError) throw revisionError;
    if (nextRevision !== null && nextRevision !== undefined) {
      worksheet.revision = Number(nextRevision);
      await saveGalleryWorksheetAdmin(workspaceId, sessionId, worksheet, Number(nextRevision));
      return;
    }
    const stored = await loadGalleryWorksheetMatchingRevisionAdmin(
      workspaceId,
      sessionId,
      attemptRevision
    );
    if (stored) {
      const byId = new Map(worksheet.rows.map((row) => [row.id, row]));
      worksheet.rows = stored.rows.map((row) => byId.get(row.id) ?? row);
      worksheet.settings = stored.settings;
    }
    const { data: revRow, error: revReadError } = await admin
      .from("gallery_sessions")
      .select("worksheet_revision")
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId)
      .single();
    if (revReadError) throw revReadError;
    attemptRevision = Number(revRow?.worksheet_revision ?? attemptRevision);
  }
  throw new Error("WORKSHEET_REVISION_CONFLICT");
}
