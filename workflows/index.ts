/**
 * Render Workflows entrypoint (same git repo as the Next.js app).
 *
 * Dashboard setup:
 *   New → Workflow
 *   Name / slug: autommerce-jobs  (must match RENDER_WORKFLOW_SLUG)
 *   Start command: npm run workflow
 *   Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY,
 *        GEMINI_API_KEY (and any other keys the web service already uses)
 *
 * Web service env:
 *   RENDER_API_KEY, RENDER_WORKFLOW_SLUG=autommerce-jobs
 * Local/dev: omit RENDER_API_KEY and start routes run the orchestrator in-process.
 */
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { executeCatalogRow, type CatalogRowTaskInput } from "../src/lib/jobs/enrich-row";
import { runEnrichSession } from "../src/lib/jobs/enrich-session";
import { executeGalleryRow, type GalleryRowTaskInput } from "../src/lib/jobs/gallery-row";
import { runGallerySession } from "../src/lib/jobs/gallery-session";
import { executeVisualizerRow, type VisualizerRowTaskInput } from "../src/lib/jobs/visualizer-row";
import { runVisualizerSession } from "../src/lib/jobs/visualizer-session";
import {
  ENRICH_ROW_TIMEOUT_SECONDS,
  SESSION_TIMEOUT_SECONDS,
  JOB_TASK_PLAN,
} from "../src/lib/jobs/config";

const sessionRetry = {
  maxRetries: 2,
  waitDurationMs: 1000,
  backoffScaling: 1.5,
};

const rowRetry = {
  maxRetries: 3,
  waitDurationMs: 1000,
  backoffScaling: 1.5,
};

export const enrichRow = task(
  {
    name: "enrichRow",
    timeoutSeconds: ENRICH_ROW_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: rowRetry,
  },
  async (_ctx: TaskContext, input: CatalogRowTaskInput) => {
    return executeCatalogRow(input);
  }
);

export const galleryRow = task(
  {
    name: "galleryRow",
    timeoutSeconds: ENRICH_ROW_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: rowRetry,
  },
  async (_ctx: TaskContext, input: GalleryRowTaskInput) => {
    return executeGalleryRow(input);
  }
);

export const visualizerRow = task(
  {
    name: "visualizerRow",
    timeoutSeconds: ENRICH_ROW_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: rowRetry,
  },
  async (_ctx: TaskContext, input: VisualizerRowTaskInput) => {
    return executeVisualizerRow(input);
  }
);

export const enrichSession = task(
  {
    name: "enrichSession",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (ctx: TaskContext, runId: string) => {
    await runEnrichSession(runId, {
      processRow: (rowId) => ctx.run(enrichRow, { runId, rowId }),
    });
    return { ok: true, runId };
  }
);

export const gallerySession = task(
  {
    name: "gallerySession",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (ctx: TaskContext, runId: string) => {
    await runGallerySession(runId, {
      processRow: (rowId) => ctx.run(galleryRow, { runId, rowId }),
    });
    return { ok: true, runId };
  }
);

export const visualizerSession = task(
  {
    name: "visualizerSession",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (ctx: TaskContext, runId: string) => {
    await runVisualizerSession(runId, {
      processRow: (rowId) => ctx.run(visualizerRow, { runId, rowId }),
    });
    return { ok: true, runId };
  }
);
