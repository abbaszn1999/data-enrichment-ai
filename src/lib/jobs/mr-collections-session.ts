import { createAdminClient } from "@/lib/supabase-admin";
import { advanceMrCollectionsPage } from "@/lib/market-research/cluster-page";
import { runJobWithFailureGuard } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  isJobCancelRequested,
  loadJobRun,
  markJobRunning,
  touchJobHeartbeat,
} from "./repo";

export async function runMrCollectionsSession(runId: string): Promise<void> {
  await runJobWithFailureGuard(runId, () => runMrCollectionsSessionInner(runId));
}

async function runMrCollectionsSessionInner(runId: string): Promise<void> {
  const admin = createAdminClient();
  const job = await loadJobRun(admin, runId);
  if (!job || job.kind !== "mr_collections") return;
  const projectId = String(job.settings.projectId || job.session_id);
  const workspaceId = job.workspace_id;
  const filters = job.settings.filters as
    | { minVolume?: number; maxKd?: number; questionsOnly?: boolean; query?: string }
    | undefined;
  await markJobRunning(admin, job.id);

  let offset = 0;
  for (;;) {
    if (await isJobCancelRequested(admin, job.id)) {
      await finishJobRun(admin, job.id, {
        status: "cancelled",
        completedCount: offset,
        failedCount: 0,
      });
      return;
    }
    const page = await advanceMrCollectionsPage(admin, workspaceId, projectId, offset, filters);
    offset = page.nextOffset;
    await touchJobHeartbeat(admin, job.id, {
      completed: page.nextOffset,
      settings: { ...job.settings, total: page.total },
    });
    if (page.done) {
      const finished = await finishJobRun(admin, job.id, {
        status: "completed",
        completedCount: page.total,
        failedCount: 0,
      });
      if (finished) await notifyJobEvent(finished, "completed", admin);
      return;
    }
  }
}
