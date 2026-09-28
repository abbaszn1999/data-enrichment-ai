import type { createAdminClient } from "@/lib/supabase-admin";
import { catalogRunFinishedCounts } from "@/lib/catalog/enrich-poll-merge";
import { CATALOG_WORKER_STALE_MS } from "./config";
import { dispatchJob } from "./dispatch";
import { loadProjectJsonAdmin } from "./project-json";
import { claimStaleJobRun, finishJobRun, loadJobRun } from "./repo";
import { isTerminalJobStatus, type JobRunRecord } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The orchestrator pings every CATALOG_HEARTBEAT_INTERVAL_MS while its process
 * lives, so a heartbeat this old means the process is gone (deploy, restart,
 * crash) — never merely a slow row.
 */
export function isCatalogWorkerStale(run: JobRunRecord, now = Date.now()): boolean {
  if (isTerminalJobStatus(run.status)) return false;
  const beat = run.heartbeat_at ? Date.parse(run.heartbeat_at) : Number.NaN;
  return !Number.isFinite(beat) || now - beat >= CATALOG_WORKER_STALE_MS;
}

/**
 * Ends a run as cancelled right now, with counts taken from rows that are
 * actually saved. Only used when no live orchestrator is left to do it.
 */
export async function forceFinishCatalogRun(
  admin: Admin,
  run: JobRunRecord
): Promise<JobRunRecord> {
  if (isTerminalJobStatus(run.status)) return run;
  const project = await loadProjectJsonAdmin(run.workspace_id, run.session_id, admin);
  const counts = project
    ? catalogRunFinishedCounts(project.rows, {
        completed_count: run.completed_count,
        failed_count: run.failed_count,
        settings: {
          processedRowIds: Array.isArray(run.settings.processedRowIds)
            ? (run.settings.processedRowIds as string[])
            : undefined,
        },
      })
    : { done: run.completed_count, failed: run.failed_count };
  const finished = await finishJobRun(
    admin,
    run.id,
    { status: "cancelled", completedCount: counts.done, failedCount: counts.failed },
    { onlyIfActive: true }
  );
  if (!finished) {
    // The worker finished it first; report whatever it wrote.
    return (await loadJobRun(admin, run.id)) ?? run;
  }
  await admin
    .from("catalog_sessions")
    .update({
      ...(project
        ? { enriched_count: project.rows.filter((row) => row.status === "done").length }
        : {}),
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.session_id)
    .eq("workspace_id", run.workspace_id);
  return finished;
}

/**
 * Self-heals a run whose orchestrator died: Stop already pressed → finish it
 * now; otherwise atomically claim it and resume from the last saved row, so
 * nothing already finished is processed (or billed by OpenAI) twice. Safe to
 * call from every status poll — only one caller can win the claim.
 */
export async function recoverStaleCatalogRun(
  admin: Admin,
  run: JobRunRecord
): Promise<JobRunRecord> {
  if (!isCatalogWorkerStale(run)) return run;
  if (run.cancel_requested) return forceFinishCatalogRun(admin, run);
  const staleBefore = new Date(Date.now() - CATALOG_WORKER_STALE_MS).toISOString();
  const claimed = await claimStaleJobRun(admin, run.id, staleBefore);
  if (!claimed) return run;
  console.warn("[jobs/catalog] orchestrator stopped responding; resuming run", {
    runId: run.id,
    lastHeartbeat: run.heartbeat_at,
  });
  await dispatchJob(run.id, "catalog");
  return claimed;
}
