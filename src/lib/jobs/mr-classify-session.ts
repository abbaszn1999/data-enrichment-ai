import { createAdminClient } from "@/lib/supabase-admin";
import {
  runMrClassifyThenClean,
  type ClassifyCheckpoint,
} from "@/lib/market-research/classify-page";
import {
  assertAiBudget,
  bindAiBillingOrThrow,
  runWithAiBilling,
} from "@/lib/billing/ai-wallet-billing";
import { runJobWithFailureGuard, withHeartbeat } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  isJobCancelRequested,
  loadJobRun,
  markJobRunning,
  touchJobHeartbeat,
} from "./repo";

export async function runMrClassifySession(runId: string): Promise<void> {
  await runJobWithFailureGuard(runId, () =>
    runWithAiBilling({ wallet: "market-research", operation: "mr_classify" }, () =>
      runMrClassifySessionInner(runId)
    )
  );
}

async function runMrClassifySessionInner(runId: string): Promise<void> {
  const admin = createAdminClient();
  const job = await loadJobRun(admin, runId);
  if (!job || job.kind !== "mr_classify") return;
  const projectId = String(job.settings.projectId || job.session_id);
  const workspaceId = job.workspace_id;
  await bindAiBillingOrThrow({ admin, workspaceId, userId: job.created_by });
  const resume = (job.settings.checkpoint as ClassifyCheckpoint | undefined) ?? null;
  await markJobRunning(admin, job.id);

  await withHeartbeat(job.id, () =>
    runMrClassifyThenClean(admin, workspaceId, projectId, {
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
        assertAiBudget();
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
