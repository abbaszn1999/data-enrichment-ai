import { createAdminClient } from "@/lib/supabase-admin";
import { notifyJobEvent } from "./notify";
import { finishJobRun, loadJobRun, touchJobHeartbeat } from "./repo";
import { isTerminalJobStatus } from "./types";
import { recordWorkerHeapBytes } from "@/lib/observability/metrics";

/**
 * Keeps `heartbeat_at` fresh while one long step runs (a single Gemini call
 * can take minutes). Without it the sweep treats the job as stale after
 * JOB_HEARTBEAT_STALE_MINUTES and starts a second worker on the same job.
 */
export async function withHeartbeat<T>(
  jobId: string,
  fn: () => Promise<T>,
  everyMs = 60_000
): Promise<T> {
  const admin = createAdminClient();
  const timer = setInterval(() => {
    void touchJobHeartbeat(admin, jobId).catch((error) =>
      console.error("[jobs] heartbeat failed", jobId, error)
    );
  }, everyMs);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

export async function runJobWithFailureGuard(
  runId: string,
  fn: () => Promise<void>
): Promise<void> {
  const startedHeap = process.memoryUsage().heapUsed;
  try {
    await fn();
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Job failed";
    console.error("[jobs] orchestrator crashed", runId, message);
    try {
      const admin = createAdminClient();
      const run = await loadJobRun(admin, runId);
      if (!run || isTerminalJobStatus(run.status)) return;
      const failed = await finishJobRun(admin, run.id, {
        status: "failed",
        completedCount: run.completed_count,
        failedCount: Math.max(run.failed_count, 1),
        lastError: message,
      });
      if (failed) await notifyJobEvent(failed, "failed", admin);
    } catch (notifyError) {
      console.error("[jobs] failed to record crash", notifyError);
    }
  } finally {
    try {
      const admin = createAdminClient();
      const run = await loadJobRun(admin, runId);
      recordWorkerHeapBytes(
        Math.max(startedHeap, process.memoryUsage().heapUsed),
        { kind: run?.kind, runId }
      );
    } catch {
      recordWorkerHeapBytes(
        Math.max(startedHeap, process.memoryUsage().heapUsed),
        { runId }
      );
    }
  }
}
