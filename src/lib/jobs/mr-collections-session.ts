import { createAdminClient } from "@/lib/supabase-admin";
import {
  advanceMrCollectionsPage,
  loadCollectionsContext,
  type CollectionsFilters,
} from "@/lib/market-research/cluster-page";
import { checkCollectionDuplicates } from "@/lib/market-research/dedupe-collections";
import { saveProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import type { ProposedCollection } from "@/components/market-research/workspace-data";
import { runJobWithFailureGuard, withHeartbeat } from "./guard";
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
  const filters = job.settings.filters as CollectionsFilters | undefined;
  await markJobRunning(admin, job.id);

  await withHeartbeat(job.id, async () => {
    const context = await loadCollectionsContext(admin, workspaceId, projectId, filters);
    const total = context.surviving.length;
    // completed_count is the next offset saved after each wave, so a
    // restarted job continues where it stopped instead of wiping the
    // collections already matched.
    let offset = Math.min(Math.max(0, job.completed_count), total);
    let collections: ProposedCollection[] | null = null;

    for (;;) {
      if (await isJobCancelRequested(admin, job.id)) {
        await finishJobRun(admin, job.id, {
          status: "cancelled",
          completedCount: offset,
          failedCount: 0,
        });
        return;
      }
      const page = await advanceMrCollectionsPage(
        admin,
        workspaceId,
        projectId,
        offset,
        context,
        collections
      );
      offset = page.nextOffset;
      collections = page.collections;
      await touchJobHeartbeat(admin, job.id, {
        completed: page.nextOffset,
        settings: { ...job.settings, total: page.total, phase: "match" },
      });
      if (page.done) break;
    }

    await touchJobHeartbeat(admin, job.id, {
      settings: { ...job.settings, total, phase: "duplicates" },
    });
    const checked = await checkCollectionDuplicates(admin, workspaceId, collections ?? []);
    if (checked.collections.length > 0) {
      await saveProjectSliceAdmin(admin, workspaceId, projectId, "collections", checked.collections);
    }

    const finished = await finishJobRun(admin, job.id, {
      status: "completed",
      completedCount: total,
      failedCount: 0,
    });
    if (finished) await notifyJobEvent(finished, "completed", admin);
  });
}
