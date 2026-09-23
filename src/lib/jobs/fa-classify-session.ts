import { createAdminClient } from "@/lib/supabase-admin";
import {
  runFaClassifyThenClean,
  type ClassifyCheckpoint,
} from "@/lib/free-assessment/classify-page";
import { runJobWithFailureGuard, withHeartbeat } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  isJobCancelRequested,
  loadJobRun,
  markJobRunning,
  touchJobHeartbeat,
} from "./repo";

export async function runFaClassifySession(runId: string): Promise<void> {
  await runJobWithFailureGuard(runId, () => runFaClassifySessionInner(runId));
}

async function runFaClassifySessionInner(runId: string): Promise<void> {
  const admin = createAdminClient();
  const job = await loadJobRun(admin, runId);
  if (!job || job.kind !== "fa_classify") return;
  const projectId = String(job.settings.projectId || job.session_id);
  const workspaceId = job.workspace_id;
  const resume = (job.settings.checkpoint as ClassifyCheckpoint | undefined) ?? null;
  await markJobRunning(admin, job.id);

  await withHeartbeat(job.id, () =>
    runFaClassifyThenClean(admin, workspaceId, projectId, {
      resume,
      onProgress: async (progress) => {
        if (await isJobCancelRequested(admin, job.id)) {
          throw new Error("Classification cancelled");
        }
        await touchJobHeartbeat(admin, job.id, {
          completed: progress.done,
          settings: {
            ...job.settings,
            phase: progress.phase,
            total: progress.total,
            checkpoint: progress.checkpoint,
          },
        });
      },
    })
  );

  const finished = await finishJobRun(admin, job.id, {
    status: "completed",
    completedCount: job.completed_count,
    failedCount: 0,
  });
  if (finished) await notifyJobEvent(finished, "completed", admin);
}
