import { createAdminClient } from "@/lib/supabase-admin";
import { processAiRow } from "@/lib/gallery/agent/process-ai-row";
import { processScrapingRow } from "@/lib/gallery/agent/process-row";
import { loadGalleryWorksheetAdmin } from "@/lib/gallery/storage-admin";
import type { GalleryRow, GalleryRunPhase } from "@/lib/gallery/types";
import { isInsufficientCredits } from "./credits";
import type { GalleryJobSettings } from "./gallery-settings";
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
  const worksheet = await loadGalleryWorksheetAdmin(
    run.workspace_id,
    run.session_id
  );
  const row = worksheet?.rows.find((candidate) => candidate.id === input.rowId);
  if (!worksheet || !row) {
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
