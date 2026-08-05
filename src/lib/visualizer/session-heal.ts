import { createAdminClient } from "@/lib/supabase-admin";
import {
  loadVisualizerWorksheetAdmin,
  loadVisualizerWorksheetMatchingRevisionAdmin,
  saveVisualizerWorksheetAdmin,
} from "@/lib/visualizer/storage-admin";
import { visualizerWarn } from "@/lib/visualizer/log";
import type {
  VisualizerSession,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

/** Prefer matching revision, then any available worksheet file. */
export async function loadVisualizerWorksheetForRead(
  workspaceId: string,
  sessionId: string,
  expectedRevision: number
): Promise<{
  worksheet: VisualizerWorksheetJson | null;
  usedFallback: boolean;
}> {
  // Short retry window — fallback opens the latest file if revisions drifted.
  const matched = await loadVisualizerWorksheetMatchingRevisionAdmin(
    workspaceId,
    sessionId,
    expectedRevision,
    3
  );
  if (matched) return { worksheet: matched, usedFallback: false };

  const fallback = await loadVisualizerWorksheetAdmin(workspaceId, sessionId);
  return { worksheet: fallback, usedFallback: !!fallback };
}

function rowCounts(worksheet: VisualizerWorksheetJson) {
  return {
    ready: worksheet.rows.filter(
      (row) =>
        row.status === "description_ready" || row.status === "images_ready"
    ).length,
    failed: worksheet.rows.filter((row) => row.status === "failed").length,
  };
}

/**
 * Reconcile DB ↔ storage after a crashed generate/sync so projects can open again.
 * - Align worksheet_revision to the file on disk when they diverge
 * - Sync total_rows to the worksheet length
 * - Unlock sessions stuck in processing when the run is no longer healthy
 */
export async function healVisualizerSessionOnRead(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  session: VisualizerSession;
  worksheet: VisualizerWorksheetJson;
  usedFallback: boolean;
  /** Treat long-running "running" as dead after this many ms (default 3 min). */
  staleRunMs?: number;
}): Promise<{
  session: VisualizerSession;
  worksheet: VisualizerWorksheetJson;
  healed: boolean;
  stillSyncing?: boolean;
}> {
  const staleRunMs = params.staleRunMs ?? 3 * 60 * 1000;
  let session = { ...params.session };
  let worksheet = { ...params.worksheet, rows: [...params.worksheet.rows] };
  let healed = false;
  const updates: Record<string, unknown> = {};

  const fileRev =
    typeof worksheet.revision === "number"
      ? worksheet.revision
      : Number(session.worksheet_revision ?? 0);
  const dbRev = Number(session.worksheet_revision ?? 0);
  const run = worksheet.activeRun;
  const runAgeMs = run?.startedAt
    ? Date.now() - new Date(run.startedAt).getTime()
    : Date.now() - new Date(session.updated_at).getTime();
  const activeFreshRun =
    session.status === "processing" &&
    run?.status === "running" &&
    runAgeMs < 90_000;

  // Live generate may briefly outpace storage visibility — don't open stale file yet.
  if (params.usedFallback && fileRev < dbRev && activeFreshRun) {
    return { session, worksheet, healed: false, stillSyncing: true };
  }

  if (params.usedFallback && fileRev !== dbRev) {
    // Storage is the readable source of truth after a crash mid-write.
    updates.worksheet_revision = fileRev;
    session.worksheet_revision = fileRev;
    worksheet.revision = fileRev;
    healed = true;
  } else if (typeof worksheet.revision !== "number") {
    worksheet.revision = dbRev;
  }

  if (worksheet.rows.length !== Number(session.total_rows ?? 0)) {
    // Don't rewrite row counts during a fresh in-flight run.
    if (!activeFreshRun) {
      updates.total_rows = worksheet.rows.length;
      session.total_rows = worksheet.rows.length;
      healed = true;
    }
  }

  // Unlock dead runs only when clearly abandoned — never during a fresh cooperative stop
  // or a healthy long OpenAI/Gemini call (can exceed 90s).
  const runLooksDead =
    session.status === "processing" &&
    (!run ||
      run.status !== "running" ||
      runAgeMs > staleRunMs ||
      (params.usedFallback &&
        run?.status === "running" &&
        runAgeMs > staleRunMs));

  if (runLooksDead) {
    if (worksheet.activeRun && worksheet.activeRun.status === "running") {
      worksheet = {
        ...worksheet,
        activeRun: {
          ...worksheet.activeRun,
          status: "failed",
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          errorMessage:
            worksheet.activeRun.errorMessage ||
            "Generation interrupted; session recovered",
        },
        rows: worksheet.rows.map((row) =>
          row.status === "generating"
            ? {
                ...row,
                status: "failed" as const,
                errorMessage:
                  row.errorMessage || "Generation interrupted; retry this row",
              }
            : row
        ),
      };
    }

    const healedCounts = rowCounts(worksheet);
    const nextStatus =
      healedCounts.ready > 0
        ? ("paused" as const)
        : healedCounts.failed > 0 ||
            worksheet.activeRun?.status === "failed" ||
            run?.status === "failed"
          ? ("failed" as const)
          : ("ready" as const);

    updates.status = nextStatus;
    updates.cancel_requested = false;
    updates.awaiting_user_action = nextStatus === "paused";
    updates.active_phase = null;
    updates.ready_rows = healedCounts.ready;
    updates.failed_rows = healedCounts.failed;
    if (!session.error_message) {
      updates.error_message =
        nextStatus === "failed"
          ? "Generation interrupted; session recovered"
          : null;
    }
    session = {
      ...session,
      status: nextStatus,
      cancel_requested: false,
      awaiting_user_action: nextStatus === "paused",
      active_phase: null,
      ready_rows: healedCounts.ready,
      failed_rows: healedCounts.failed,
      error_message:
        (updates.error_message as string | null | undefined) ??
        session.error_message,
    };
    healed = true;

    try {
      await saveVisualizerWorksheetAdmin(
        params.workspaceId,
        session.id,
        worksheet,
        Number(session.worksheet_revision ?? fileRev)
      );
    } catch (error) {
      visualizerWarn("session-heal", "Could not rewrite worksheet during heal", {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await params.admin
      .from("visualizer_sessions")
      .update(updates)
      .eq("id", session.id)
      .eq("workspace_id", params.workspaceId);
    if (error) {
      visualizerWarn("session-heal", "Could not update session during heal", {
        sessionId: session.id,
        error: error.message,
      });
    } else {
      healed = true;
    }
  }

  return { session, worksheet, healed };
}

/** Best-effort unlock after generate throws (network/API crash). */
export async function recoverVisualizerFailedRun(params: {
  workspaceId: string;
  sessionId: string;
  errorMessage: string;
}): Promise<void> {
  const admin = createAdminClient();
  const message = params.errorMessage.slice(0, 500);

  // Always unlock the DB row first so the project is not stuck processing.
  const { error: unlockError } = await admin
    .from("visualizer_sessions")
    .update({
      status: "failed",
      cancel_requested: false,
      awaiting_user_action: false,
      active_phase: null,
      error_message: message,
    })
    .eq("id", params.sessionId)
    .eq("workspace_id", params.workspaceId);
  if (unlockError) throw unlockError;

  try {
    const { data: sessionRow } = await admin
      .from("visualizer_sessions")
      .select("worksheet_revision, total_rows")
      .eq("id", params.sessionId)
      .eq("workspace_id", params.workspaceId)
      .maybeSingle();

    const worksheet = await loadVisualizerWorksheetAdmin(
      params.workspaceId,
      params.sessionId
    );
    if (!worksheet) return;

    const next: VisualizerWorksheetJson = {
      ...worksheet,
      rows: worksheet.rows.map((row) =>
        row.status === "generating"
          ? {
              ...row,
              status: "failed" as const,
              errorMessage: row.errorMessage || message,
            }
          : row
      ),
      activeRun: worksheet.activeRun
        ? {
            ...worksheet.activeRun,
            status: "failed",
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            errorMessage: message,
          }
        : null,
    };

    const rev = Number(sessionRow?.worksheet_revision ?? next.revision ?? 0);
    next.revision = rev;
    await saveVisualizerWorksheetAdmin(
      params.workspaceId,
      params.sessionId,
      next,
      rev
    );

    const counts = rowCounts(next);
    await admin
      .from("visualizer_sessions")
      .update({
        total_rows: next.rows.length,
        ready_rows: counts.ready,
        failed_rows: counts.failed,
        worksheet_revision: rev,
      })
      .eq("id", params.sessionId)
      .eq("workspace_id", params.workspaceId);
  } catch (error) {
    visualizerWarn("session-heal", "Unlocked session but worksheet recover failed", {
      sessionId: params.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
