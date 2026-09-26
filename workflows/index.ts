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
import { runMrExtractSession } from "../src/lib/jobs/mr-extract-session";
import { runFaExtractSession } from "../src/lib/jobs/fa-extract-session";
import { runMrStage1Session } from "../src/lib/jobs/mr-stage1-session";
import { runFaStage1Session } from "../src/lib/jobs/fa-stage1-session";
import { runMrClassifySession } from "../src/lib/jobs/mr-classify-session";
import { runFaClassifySession } from "../src/lib/jobs/fa-classify-session";
import { runMrCollectionsSession } from "../src/lib/jobs/mr-collections-session";
import {
  ENRICH_ROW_TIMEOUT_SECONDS,
  GALLERY_ROW_TIMEOUT_SECONDS,
  IMAGE_FINDER_ROW_TIMEOUT_SECONDS,
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

export const imageFinderRow = task(
  {
    name: "imageFinderRow",
    timeoutSeconds: IMAGE_FINDER_ROW_TIMEOUT_SECONDS,
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
    timeoutSeconds: GALLERY_ROW_TIMEOUT_SECONDS,
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
      processRow: (rowId, context) =>
        ctx.run(context.imageFinder ? imageFinderRow : enrichRow, {
          runId,
          rowId,
          learnedDomains: context.learnedDomains,
          recheck: context.recheck,
        }),
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

export const mrExtractSession = task(
  {
    name: "mrExtractSession",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (_ctx: TaskContext, runId: string) => {
    await runMrExtractSession(runId);
    return { ok: true, runId };
  }
);

export const mrStage1Session = task(
  {
    name: "mrStage1Session",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (_ctx: TaskContext, runId: string) => {
    await runMrStage1Session(runId);
    return { ok: true, runId };
  }
);

export const faStage1Session = task(
  {
    name: "faStage1Session",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (_ctx: TaskContext, runId: string) => {
    await runFaStage1Session(runId);
    return { ok: true, runId };
  }
);

export const mrClassifySession = task(
  {
    name: "mrClassifySession",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (_ctx: TaskContext, runId: string) => {
    await runMrClassifySession(runId);
    return { ok: true, runId };
  }
);

export const faClassifySession = task(
  {
    name: "faClassifySession",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (_ctx: TaskContext, runId: string) => {
    await runFaClassifySession(runId);
    return { ok: true, runId };
  }
);

export const mrCollectionsSession = task(
  {
    name: "mrCollectionsSession",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (_ctx: TaskContext, runId: string) => {
    await runMrCollectionsSession(runId);
    return { ok: true, runId };
  }
);

export const faExtractSession = task(
  {
    name: "faExtractSession",
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
    plan: JOB_TASK_PLAN,
    retry: sessionRetry,
  },
  async (_ctx: TaskContext, runId: string) => {
    await runFaExtractSession(runId);
    return { ok: true, runId };
  }
);
