import { createAdminClient } from "@/lib/supabase-admin";
import { fetchStoreCatalog } from "@/lib/market-research/agent/store-catalog";
import {
  advanceStage1Discovery,
  type Stage1Checkpoint,
} from "@/lib/market-research/agent/stage1-niche-discovery";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import { markSliceSavedAdmin } from "@/lib/market-research/server-persist";
import { runJobWithFailureGuard, withHeartbeat } from "./guard";
import { notifyJobEvent } from "./notify";
import {
  finishJobRun,
  isJobCancelRequested,
  loadJobRun,
  markJobRunning,
  touchJobHeartbeat,
} from "./repo";

export async function runMrStage1Session(runId: string): Promise<void> {
  await runJobWithFailureGuard(runId, () => runMrStage1SessionInner(runId));
}

async function runMrStage1SessionInner(runId: string): Promise<void> {
  const admin = createAdminClient();
  const job = await loadJobRun(admin, runId);
  if (!job || job.kind !== "mr_stage1") return;
  const projectId = String(job.settings.projectId || job.session_id);
  const workspaceId = job.workspace_id;
  await markJobRunning(admin, job.id);

  await withHeartbeat(job.id, async () => {
    const catalog = await fetchStoreCatalog(admin, workspaceId);
    await saveProjectSliceAdmin(admin, workspaceId, projectId, "catalog", {
      storeName: catalog.storeName,
      provider: catalog.provider,
      baseUrl: catalog.baseUrl,
      collections: catalog.collections,
      storeBrands: catalog.storeBrands,
    });

    const saved =
      (await loadProjectSliceAdmin<Stage1Checkpoint>(
        admin,
        workspaceId,
        projectId,
        "stage1-job"
      ).catch(() => null)) ?? null;
    let checkpoint: Stage1Checkpoint | null = saved?.jobId === job.id ? saved : null;

    const total = catalog.collections.length + catalog.storeBrands.length;
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
        storeName: catalog.storeName,
        collections: catalog.collections,
        storeBrands: catalog.storeBrands,
        checkpoint,
      });
      checkpoint = { ...step.checkpoint, jobId: job.id };
      await saveProjectSliceAdmin(admin, workspaceId, projectId, "stage1-job", checkpoint);
      await touchJobHeartbeat(admin, job.id, {
        completed: checkpoint.offset,
        failed: 0,
      });
      if (!step.done || !step.result) continue;

      const nichesPayload = {
        niches: step.result.niches,
        structuredNiches: step.result.structuredNiches,
        excludedItems: step.result.excludedItems ?? [],
        agentConclusion: step.result.agentConclusion,
        isAiGenerated: step.result.isAiGenerated,
      };
      await saveProjectSliceAdmin(admin, workspaceId, projectId, "niches", nichesPayload);
      await markSliceSavedAdmin(admin, projectId, "niches", nichesPayload);
      const finished = await finishJobRun(admin, job.id, {
        status: "completed",
        completedCount: total,
        failedCount: 0,
      });
      if (finished) await notifyJobEvent(finished, "completed", admin);
      return;
    }
  });
}
