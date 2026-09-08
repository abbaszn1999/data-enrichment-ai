import { createAdminClient } from "@/lib/supabase-admin";
import { notifyJobEvent } from "./notify";
import { finishJobRun, loadJobRun } from "./repo";
import { isTerminalJobStatus } from "./types";
import { recordWorkerHeapBytes } from "@/lib/observability/metrics";

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
