import { createAdminClient } from "@/lib/supabase-admin";
import { csvRowsToCollectionItems } from "@/lib/free-assessment/agent/csv-catalog";
import {
  advanceStage1Discovery,
  type Stage1Checkpoint,
} from "@/lib/free-assessment/agent/stage1-niche-discovery";
import type { AssessmentPlpRow } from "@/components/free-assessment/assessment-csv";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/free-assessment/storage-admin";
import { runJobWithFailureGuard } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  isJobCancelRequested,
  loadJobRun,
  markJobRunning,
  touchJobHeartbeat,
} from "./repo";

export async function runFaStage1Session(runId: string): Promise<void> {
  await runJobWithFailureGuard(runId, () => runFaStage1SessionInner(runId));
}

async function runFaStage1SessionInner(runId: string): Promise<void> {
  const admin = createAdminClient();
  const job = await loadJobRun(admin, runId);
  if (!job || job.kind !== "fa_stage1") return;
  const projectId = String(job.settings.projectId || job.session_id);
  const workspaceId = job.workspace_id;
  await markJobRunning(admin, job.id);

  const catalog = await loadProjectSliceAdmin<{ plpRows: AssessmentPlpRow[] }>(
    admin,
    workspaceId,
    projectId,
    "catalog"
  );
  const plpRows = catalog?.plpRows ?? [];
  const { collections, brands } = csvRowsToCollectionItems(plpRows);

  let checkpoint =
    (await loadProjectSliceAdmin<Stage1Checkpoint>(
      admin,
      workspaceId,
      projectId,
      "stage1-job"
    ).catch(() => null)) ?? null;

  for (;;) {
    if (await isJobCancelRequested(admin, job.id)) {
      await finishJobRun(admin, job.id, {
        status: "cancelled",
        completedCount: checkpoint?.offset ?? 0,
        failedCount: 0,
      });
      return;
    }
    const step = await advanceStage1Discovery({
      storeName: "the uploaded catalog",
      collections,
      storeBrands: brands,
      checkpoint,
    });
    checkpoint = step.checkpoint;
    await saveProjectSliceAdmin(admin, workspaceId, projectId, "stage1-job", checkpoint);
    await touchJobHeartbeat(admin, job.id, {
      completed: step.checkpoint.offset,
      failed: 0,
    });
    if (!step.done || !step.result) continue;

    await saveProjectSliceAdmin(admin, workspaceId, projectId, "niches", {
      niches: step.result.niches,
      structuredNiches: step.result.structuredNiches,
      excludedItems: step.result.excludedItems ?? [],
      agentConclusion: step.result.agentConclusion,
      isAiGenerated: step.result.isAiGenerated,
    });
    const finished = await finishJobRun(admin, job.id, {
      status: "completed",
      completedCount: plpRows.length,
      failedCount: 0,
    });
    if (finished) await notifyJobEvent(finished, "completed", admin);
    return;
  }
}
