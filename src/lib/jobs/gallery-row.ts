import { createAdminClient } from "@/lib/supabase-admin";
import { galleryRowStoreEnabled } from "@/lib/catalog/flag";
import { processAiRow } from "@/lib/gallery/agent/process-ai-row";
import { processScrapingRow } from "@/lib/gallery/agent/process-row";
import { galleryLog, galleryWarn } from "@/lib/gallery/log";
import { loadGalleryWorksheetAdmin } from "@/lib/gallery/storage-admin";
import {
  applyGalleryProjectSettings,
  createEmptyWorksheet,
  type GalleryProjectSettings,
  GalleryRow,
  GalleryRunPhase,
  GalleryWorksheetJson,
} from "@/lib/gallery/types";
import { isInsufficientCredits } from "./credits";
import { isGalleryCancelled } from "./gallery-cancel";
import {
  hydrateGalleryWorksheetForJob,
  parseGalleryJobRuntimeSettings,
  type GalleryJobSettings,
} from "./gallery-settings";
import { loadJobRun } from "./repo";

export type GalleryRowTaskInput = {
  runId: string;
  rowId: string;
};

export type GalleryRowOutcome = {
  rowId: string;
  status: GalleryRow["status"];
  errorMessage?: string;
  mainImagePaths?: string[];
  mainImagePath?: string | null;
  galleryImagePaths?: string[];
  sourceMeta?: GalleryRow["sourceMeta"];
  creditsUsed: number;
  cost: number;
  generationStage?: GalleryRow["generationStage"];
  error?: string;
  noCredits?: boolean;
};

async function loadGallerySessionSettings(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  sessionId: string
): Promise<GalleryProjectSettings | null> {
  const { data, error } = await admin
    .from("gallery_sessions")
    .select("settings")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    galleryWarn("row:hydrate", "Could not load gallery session settings", {
      sessionId,
      error: error.message,
    });
    return null;
  }
  return parseGalleryJobRuntimeSettings(data?.settings);
}

export async function resolveGalleryRowWorksheet(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  sessionId: string;
  worksheet: GalleryWorksheetJson;
  jobSettings: GalleryJobSettings;
}): Promise<GalleryWorksheetJson> {
  const fromJob = parseGalleryJobRuntimeSettings(params.jobSettings.runtimeSettings);
  const runtimeSettings =
    fromJob ??
    (await loadGallerySessionSettings(
      params.admin,
      params.workspaceId,
      params.sessionId
    ));
  const hydrated = hydrateGalleryWorksheetForJob(params.worksheet, runtimeSettings);
  const provider = params.jobSettings.provider;
  const active =
    provider === "ai" ? hydrated.settings.ai : hydrated.settings.scraping;
  galleryLog("row:hydrate", "Applied gallery run settings", {
    source: fromJob ? "job" : runtimeSettings ? "session" : "worksheet-default",
    galleryImagesPerRow: active.imagesPerRow,
  });
  return hydrated;
}

/**
 * A Scraping row task needs only its own row plus the run's frozen settings.
 * Loading the whole worksheet (blob + every row of a 5,000-row sheet) for each
 * child task would multiply the reads by the row count, so the row comes
 * straight from the row store. Returns null when that is not possible (row
 * store off, row missing) and the caller falls back to the full load.
 */
export async function loadGalleryRowContext(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  sessionId: string;
  rowId: string;
  jobSettings: GalleryJobSettings;
}): Promise<{ worksheet: GalleryWorksheetJson; row: GalleryRow } | null> {
  if (params.jobSettings.provider === "ai" || !galleryRowStoreEnabled()) return null;
  const runtime =
    parseGalleryJobRuntimeSettings(params.jobSettings.runtimeSettings) ??
    (await loadGallerySessionSettings(params.admin, params.workspaceId, params.sessionId));
  if (!runtime) return null;
  const { data, error } = await params.admin
    .from("gallery_session_rows")
    .select("row_id, row_index, status, data")
    .eq("session_id", params.sessionId)
    .eq("row_id", params.rowId)
    .maybeSingle();
  if (error || !data) return null;
  const payload = (data.data ?? {}) as Partial<GalleryRow>;
  if (!payload.originalData || typeof payload.originalData !== "object") return null;
  const row: GalleryRow = {
    ...(payload as GalleryRow),
    id: data.row_id as string,
    rowIndex: Number(data.row_index ?? 0),
    status: data.status as GalleryRow["status"],
    galleryImagePaths: Array.isArray(payload.galleryImagePaths) ? payload.galleryImagePaths : [],
    mainImagePath: payload.mainImagePath ?? null,
  };
  const base = createEmptyWorksheet(params.sessionId, Object.keys(row.originalData), []);
  const worksheet = applyGalleryProjectSettings({ ...base, rows: [row] }, runtime);
  return { worksheet, row };
}

export async function executeGalleryRow(
  input: GalleryRowTaskInput
): Promise<GalleryRowOutcome> {
  const admin = createAdminClient();
  const run = await loadJobRun(admin, input.runId);
  if (!run || run.kind !== "gallery") {
    return {
      rowId: input.rowId,
      status: "failed",
      error: "Job run not found",
      creditsUsed: 0,
      cost: 0,
    };
  }
  const settings = run.settings as GalleryJobSettings;
  const single = await loadGalleryRowContext({
    admin,
    workspaceId: run.workspace_id,
    sessionId: run.session_id,
    rowId: input.rowId,
    jobSettings: settings,
  });
  const loaded =
    single?.worksheet ??
    (await loadGalleryWorksheetAdmin(run.workspace_id, run.session_id));
  if (!loaded) {
    return {
      rowId: input.rowId,
      status: "failed",
      error: "Row not found",
      creditsUsed: 0,
      cost: 0,
    };
  }
  const worksheet = single
    ? single.worksheet
    : await resolveGalleryRowWorksheet({
        admin,
        workspaceId: run.workspace_id,
        sessionId: run.session_id,
        worksheet: loaded,
        jobSettings: settings,
      });
  const row = worksheet.rows.find((candidate) => candidate.id === input.rowId);
  if (!row) {
    return {
      rowId: input.rowId,
      status: "failed",
      error: "Row not found",
      creditsUsed: 0,
      cost: 0,
    };
  }

  const runPhase: GalleryRunPhase =
    settings.targetPhases?.[input.rowId] ?? "full";
  const shared = {
    workspaceId: run.workspace_id,
    sessionId: run.session_id,
    worksheet: structuredClone(worksheet),
    row: structuredClone(row),
    ownerUserId: settings.ownerUserId,
    actorUserId: settings.actorUserId,
    runId: settings.galleryRunId || run.id,
    runPhase,
    onCheckpoint: async () => undefined,
    // Checked between research rounds: Stop ends the row within one round.
    shouldCancel: () =>
      isGalleryCancelled(admin, run.id, run.session_id, run.workspace_id),
  };

  let result: Awaited<ReturnType<typeof processScrapingRow>>;
  try {
    result =
      settings.provider === "ai"
        ? await processAiRow(shared)
        : await processScrapingRow({ admin, ...shared });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Row processing failed";
    return {
      rowId: input.rowId,
      status: settings.previousStatus?.[input.rowId] === "ready" ? "ready" : "failed",
      errorMessage: message,
      error: message,
      creditsUsed: 0,
      cost: 0,
    };
  }

  const previousReady = settings.previousStatus?.[input.rowId] === "ready";
  const status =
    previousReady && result.row.status === "failed" ? "ready" : result.row.status;
  const error = result.error;
  return {
    rowId: input.rowId,
    status,
    errorMessage: result.row.errorMessage,
    mainImagePaths: result.row.mainImagePaths,
    mainImagePath: result.row.mainImagePath,
    galleryImagePaths: result.row.galleryImagePaths,
    sourceMeta: result.row.sourceMeta,
    creditsUsed: result.creditsUsed,
    cost: result.cost,
    generationStage: undefined,
    error,
    noCredits: isInsufficientCredits(error),
  };
}
