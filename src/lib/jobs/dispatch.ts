import { createAdminClient } from "@/lib/supabase-admin";
import { runEnrichSession } from "./enrich-session";
import { runGallerySession } from "./gallery-session";
import { runVisualizerSession } from "./visualizer-session";
import { runMrExtractSession } from "./mr-extract-session";
import { loadJobRun } from "./repo";
import type { JobKind } from "./types";

export function workflowTaskName(kind: JobKind): string {
  if (kind === "catalog") return "enrichSession";
  if (kind === "gallery") return "gallerySession";
  if (kind === "visualizer") return "visualizerSession";
  return "mrExtractSession";
}

export async function runOrchestrator(runId: string, kind?: JobKind): Promise<void> {
  let resolved = kind;
  if (!resolved) {
    const run = await loadJobRun(createAdminClient(), runId);
    resolved = run?.kind;
  }
  if (resolved === "gallery") {
    await runGallerySession(runId);
    return;
  }
  if (resolved === "visualizer") {
    await runVisualizerSession(runId);
    return;
  }
  if (resolved === "mr_extract") {
    await runMrExtractSession(runId);
    return;
  }
  await runEnrichSession(runId);
}

export async function dispatchJob(runId: string, kind: JobKind): Promise<void> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  const workflowSlug = process.env.RENDER_WORKFLOW_SLUG?.trim() || "autommerce-jobs";

  if (apiKey) {
    try {
      const { Render } = await import("@renderinc/sdk");
      const render = new Render({ token: apiKey });
      const taskSlug = `${workflowSlug}/${workflowTaskName(kind)}`;
      const started = await render.workflows.startTask(taskSlug, [runId]);
      if (started?.taskRunId) {
        await createAdminClient()
          .from("job_runs")
          .update({
            task_run_id: started.taskRunId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId);
      }
      return;
    } catch (error) {
      console.error(
        "[jobs/dispatch] Render Workflows start failed; running in-process",
        error instanceof Error ? error.message : error
      );
    }
  }

  try {
    const { after } = await import("next/server");
    after(() =>
      runOrchestrator(runId, kind).catch((error) => {
        console.error("[jobs/dispatch] in-process orchestrator failed", error);
      })
    );
  } catch {
    void runOrchestrator(runId, kind).catch((error) => {
      console.error("[jobs/dispatch] in-process orchestrator failed", error);
    });
  }
}
