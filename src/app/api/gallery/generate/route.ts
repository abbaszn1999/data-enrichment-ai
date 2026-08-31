import { NextRequest, NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import {
  estimateGalleryCredits,
  estimateScrapingCreditRange,
} from "@/lib/gallery/pricing";
import {
  loadGalleryWorksheetAdmin,
  loadGalleryWorksheetConsistentAdmin,
  saveGalleryWorksheetAdmin,
} from "@/lib/gallery/storage-admin";
import { signGalleryWorksheetImages } from "@/lib/gallery/signed-urls";
import { galleryError, galleryLog } from "@/lib/gallery/log";
import { parseGalleryProjectSettings } from "@/lib/gallery/settings-schema";
import {
  galleryReferencePathsBelongToSession,
  worksheetImageRefsBelongToSession,
} from "@/lib/gallery/worksheet-security";
import { withGalleryWorksheetLock } from "@/lib/gallery/worksheet-lock";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { insertJobRun } from "@/lib/jobs/repo";
import type { GalleryJobSettings } from "@/lib/jobs/gallery-settings";
import type {
  GalleryProjectSettings,
  GalleryProvider,
  GalleryRunPhase,
  GallerySession,
  GalleryWorksheetJson,
} from "@/lib/gallery/types";
import {
  applyGalleryProjectSettings,
  getGalleryProjectSettingsFromWorksheet,
  normalizeGalleryWorksheet,
  resolveGalleryRunPhase,
} from "@/lib/gallery/types";

export const maxDuration = 60;

type Body = {
  workspaceId?: string;
  sessionId?: string;
  rowIds?: string[];
  provider?: GalleryProvider | "google";
  settingsSnapshot?: GalleryProjectSettings;
  worksheetSnapshot?: GalleryWorksheetJson;
  worksheetRevision?: number;
  estimateOnly?: boolean;
  retryFailed?: boolean;
  imagesPerRow?: number;
  /** Explicit Main images count from the UI (avoids stale worksheet settings). */
  mainImagesPerRow?: number;
  originalImageColumn?: string | null;
  /**
   * Optional explicit phase. When omitted (or for mixed selections), each row
   * independently resolves its own phase via resolveGalleryRunPhase: rows
   * without a Main image (and no usable original image) get Main only and
   * stop there; rows with an existing Main or a usable original image get
   * Gallery only. A single row never runs Main and Gallery back-to-back.
   */
  runPhase?: GalleryRunPhase;
};

export async function POST(request: NextRequest) {
  const recovery = (await request
    .clone()
    .json()
    .catch(() => null)) as Body | null;
  try {
    return await generateSynchronously(request);
  } catch (error) {
    galleryError("generate", "Synchronous gallery generation failed", error);
    if (recovery?.workspaceId && recovery.sessionId) {
      try {
        const worksheet = await loadGalleryWorksheetAdmin(
          recovery.workspaceId,
          recovery.sessionId
        );
        if (worksheet?.activeRun) {
          worksheet.activeRun.status = "failed";
          worksheet.activeRun.finishedAt = new Date().toISOString();
          for (const row of worksheet.rows) {
            if (row.status === "queued" || row.status === "generating") {
              row.status = "failed";
              row.generationStage = undefined;
              row.errorMessage = "Generation was interrupted; retry this row";
            }
          }
          await saveGalleryWorksheetAdmin(
            recovery.workspaceId,
            recovery.sessionId,
            worksheet
          );
        }
        const admin = (await import("@/lib/supabase-admin")).createAdminClient();
        await admin
          .from("gallery_sessions")
          .update({
            status: "failed",
            cancel_requested: false,
            error_message:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Generation failed",
          })
          .eq("id", recovery.sessionId)
          .eq("workspace_id", recovery.workspaceId);
      } catch (recoveryError) {
        galleryError("generate:recovery", "Could not recover failed run", recoveryError);
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}

async function generateSynchronously(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, sessionId } = body;
  if (!workspaceId || !sessionId) {
    return NextResponse.json(
      { error: "workspaceId and sessionId are required" },
      { status: 400 }
    );
  }

  const provider: GalleryProvider = body.provider === "ai" ? "ai" : "scraping";
  if (provider === "scraping" && !process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "Scraping is temporarily unavailable. Contact your administrator." },
      { status: 503 }
    );
  }

  const auth = await requireGalleryAuth({
    workspaceId,
    requireWrite: true,
    requireCredits: true,
  });
  if (!auth.ok) return auth.response;

  const { data: session, error: sessionError } = await auth.admin
    .from("gallery_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (sessionError || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: auth.headers });
  }

  const loadedWorksheet = await loadGalleryWorksheetConsistentAdmin(
    workspaceId,
    sessionId,
    Number(session.total_rows)
  );
  if (!loadedWorksheet) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      { status: 409, headers: { ...auth.headers, "Retry-After": "2" } }
    );
  }
  let worksheet: GalleryWorksheetJson = loadedWorksheet;
  if (
    !body.worksheetSnapshot ||
    body.worksheetSnapshot.sessionId !== sessionId ||
    !Number.isInteger(body.worksheetRevision) ||
    Number(body.worksheetRevision) !== Number(session.worksheet_revision) ||
    body.worksheetSnapshot.rows.length !== Number(session.total_rows)
  ) {
    return NextResponse.json(
      { error: "Worksheet changed. Reload before starting generation." },
      { status: 409, headers: auth.headers }
    );
  }
  const storedRowIds = new Set(worksheet.rows.map((row) => row.id));
  if (
    body.worksheetSnapshot.rows.some((row) => !storedRowIds.has(row.id))
  ) {
    return NextResponse.json(
      { error: "Worksheet rows do not match the saved project" },
      { status: 400, headers: auth.headers }
    );
  }
  if (
    !worksheetImageRefsBelongToSession(
      body.worksheetSnapshot,
      workspaceId,
      sessionId
    )
  ) {
    return NextResponse.json(
      { error: "Worksheet contains an invalid private image path" },
      { status: 400, headers: auth.headers }
    );
  }
  worksheet = normalizeGalleryWorksheet(body.worksheetSnapshot);

  let runtimeSettings: GalleryProjectSettings;
  try {
    runtimeSettings = parseGalleryProjectSettings(body.settingsSnapshot);
  } catch {
    return NextResponse.json(
      { error: "A valid settingsSnapshot is required" },
      { status: 400, headers: auth.headers }
    );
  }
  if (runtimeSettings.provider !== provider) {
    return NextResponse.json(
      { error: "settingsSnapshot provider does not match provider" },
      { status: 400, headers: auth.headers }
    );
  }
  if (
    !galleryReferencePathsBelongToSession(
      runtimeSettings,
      workspaceId,
      sessionId
    )
  ) {
    return NextResponse.json(
      { error: "One or more reference image paths are invalid" },
      { status: 400, headers: auth.headers }
    );
  }
  const worksheetColumns = worksheet.columns;
  if (
    runtimeSettings.originalImageColumn !== null &&
    !worksheetColumns.includes(runtimeSettings.originalImageColumn)
  ) {
    return NextResponse.json(
      { error: "Invalid original image column" },
      { status: 400, headers: auth.headers }
    );
  }
  if (
    runtimeSettings.selectedColumns.length === 0 ||
    runtimeSettings.selectedColumns.some(
      (column) => !worksheetColumns.includes(column)
    )
  ) {
    return NextResponse.json(
      { error: "Select at least one valid product column before generation" },
      { status: 400, headers: auth.headers }
    );
  }
  worksheet = applyGalleryProjectSettings(worksheet, runtimeSettings);
  if (worksheet.selectedColumns.length === 0) {
    return NextResponse.json(
      { error: "Select at least one product column before generation" },
      { status: 400, headers: auth.headers }
    );
  }

  if (body.imagesPerRow !== undefined) {
    const imagesPerRow = Number(body.imagesPerRow);
    const maximum = provider === "ai" ? 8 : 12;
    if (!Number.isInteger(imagesPerRow) || imagesPerRow < 1 || imagesPerRow > maximum) {
      return NextResponse.json(
        { error: `imagesPerRow must be between 1 and ${maximum}` },
        { status: 400, headers: auth.headers }
      );
    }
    if (provider === "ai") worksheet.settings.ai.imagesPerRow = imagesPerRow;
    else worksheet.settings.scraping.imagesPerRow = imagesPerRow;
  }

  if (body.mainImagesPerRow !== undefined) {
    const mainImagesPerRow = Number(body.mainImagesPerRow);
    if (
      !Number.isInteger(mainImagesPerRow) ||
      mainImagesPerRow < 1 ||
      mainImagesPerRow > 6
    ) {
      return NextResponse.json(
        { error: "mainImagesPerRow must be between 1 and 6" },
        { status: 400, headers: auth.headers }
      );
    }
    if (provider === "ai") {
      worksheet.settings.ai.main = {
        ...worksheet.settings.ai.main,
        imagesPerRow: mainImagesPerRow,
      };
    } else {
      worksheet.settings.scraping.main = {
        ...worksheet.settings.scraping.main,
        imagesPerRow: mainImagesPerRow,
      };
    }
  }

  galleryLog("generate:settings", "Applied generate overrides from UI", {
    provider,
    galleryImagesPerRow:
      provider === "ai"
        ? worksheet.settings.ai.imagesPerRow
        : worksheet.settings.scraping.imagesPerRow,
    mainImagesPerRow:
      provider === "ai"
        ? worksheet.settings.ai.main?.imagesPerRow
        : worksheet.settings.scraping.main?.imagesPerRow,
  });

  if ("originalImageColumn" in body) {
    const raw = body.originalImageColumn;
    const column =
      raw === null || raw === undefined || raw === "" || raw === "none"
        ? null
        : String(raw);
    if (column !== null && !worksheet.columns.includes(column)) {
      return NextResponse.json(
        { error: "Invalid original image column" },
        { status: 400, headers: auth.headers }
      );
    }
    worksheet.originalImageColumn = column;
    worksheet.originalImageSelectionExplicit = true;
  } else if (!worksheet.originalImageSelectionExplicit) {
    worksheet.originalImageColumn = null;
  }

  worksheet.settings.provider = provider;

  let targetIds = body.rowIds?.length ? [...new Set(body.rowIds)] : [];
  if (body.retryFailed) {
    const failedIds = new Set(
      worksheet.rows.filter((row) => row.status === "failed").map((row) => row.id)
    );
    targetIds = targetIds.length
      ? targetIds.filter((id) => failedIds.has(id))
      : [...failedIds];
  }
  if (targetIds.length === 0) {
    return NextResponse.json(
      { error: "No rows selected" },
      { status: 400, headers: auth.headers }
    );
  }
  const rowsById = new Map(worksheet.rows.map((row) => [row.id, row]));
  if (targetIds.some((id) => !rowsById.has(id))) {
    return NextResponse.json(
      { error: "Some selected rows do not exist" },
      { status: 400, headers: auth.headers }
    );
  }

  const rowsWithOriginal =
    provider === "scraping" && worksheet.originalImageColumn
      ? targetIds.filter((id) => {
          const value = rowsById.get(id)?.originalData[worksheet.originalImageColumn!];
          return typeof value === "string" && value.trim().length > 0;
        }).length
      : 0;
  const estimateRange =
    provider === "scraping"
      ? estimateScrapingCreditRange({
          rowCount: targetIds.length,
          searchDepth: worksheet.settings.scraping.searchDepth,
          rowsWithOriginal,
          tier: worksheet.settings.scraping.tier,
        })
      : null;
  const estimatedCredits =
    estimateRange?.max ??
    estimateGalleryCredits(provider, targetIds.length, worksheet.settings.ai, {
      generateMainPerRow: provider === "ai" && !worksheet.originalImageColumn,
      searchDepth: worksheet.settings.scraping.searchDepth,
      rowsWithOriginal,
      tier: worksheet.settings.scraping.tier,
    });

  if (body.estimateOnly) {
    return NextResponse.json(
      {
        estimatedCredits,
        estimateRange,
        remaining: auth.ctx.credits.total,
        rowCount: targetIds.length,
        provider,
      },
      { headers: auth.headers }
    );
  }
  if (auth.ctx.credits.total < estimatedCredits) {
    return NextResponse.json(
      {
        error: "INSUFFICIENT_CREDITS",
        remaining: auth.ctx.credits.total,
        required: estimatedCredits,
      },
      { status: 402, headers: auth.headers }
    );
  }

  const runId = crypto.randomUUID();
  const { data: claimed, error: claimError } = await auth.admin.rpc(
    "claim_gallery_session_run",
    {
      p_session_id: sessionId,
      p_workspace_id: workspaceId,
    }
  );
  if (claimError) throw claimError;
  if (!claimed) {
    return NextResponse.json(
      { error: "A generation run is already in progress" },
      { status: 409, headers: auth.headers }
    );
  }
  const { error: clearCancelError } = await auth.admin
    .from("gallery_sessions")
    .update({ cancel_requested: false })
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId);
  if (clearCancelError) throw clearCancelError;

  const previousStatus = new Map(
    targetIds.map((id) => [id, rowsById.get(id)!.status])
  );
  worksheet.activeRun = {
    id: runId,
    status: "running",
    provider,
    selectedRowIds: targetIds,
    total: targetIds.length,
    completed: 0,
    failed: 0,
    estimatedCredits,
    usedCredits: 0,
    cancelRequested: false,
    startedAt: new Date().toISOString(),
  };
  const targetPhases = new Map<string, GalleryRunPhase>();
  for (const rowId of targetIds) {
    const row = rowsById.get(rowId)!;
    const targetPhase = resolveGalleryRunPhase({
      originalImageColumn: worksheet.originalImageColumn,
      row,
      requested: body.runPhase ?? null,
    });
    targetPhases.set(rowId, targetPhase);
    row.status = "queued";
    row.generationStage = "planning";
    row.generationTarget = targetPhase;
    row.errorMessage = undefined;
  }
  await withGalleryWorksheetLock(workspaceId, sessionId, async () => {
    const { data: revRow, error: revReadError } = await auth.admin
      .from("gallery_sessions")
      .select("worksheet_revision")
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId)
      .single();
    if (revReadError) throw revReadError;
    const expectedRevision = Number(revRow?.worksheet_revision ?? 0);
    const { data: nextRevision, error: revisionError } = await auth.admin.rpc(
      "claim_gallery_worksheet_revision",
      {
        p_session_id: sessionId,
        p_workspace_id: workspaceId,
        p_expected_revision: expectedRevision,
      }
    );
    if (revisionError) throw revisionError;
    if (nextRevision === null || nextRevision === undefined) {
      throw new Error("WORKSHEET_REVISION_CONFLICT");
    }
    worksheet.revision = Number(nextRevision);
    await saveGalleryWorksheetAdmin(
      workspaceId,
      sessionId,
      worksheet,
      Number(nextRevision)
    );
  });

  const { data: workspace } = await auth.admin
    .from("workspaces")
    .select("slug, name")
    .eq("id", workspaceId)
    .single();

  const ownerUserId = auth.ctx.subscription!.user_id as string;
  runtimeSettings = getGalleryProjectSettingsFromWorksheet(worksheet);
  const jobSettings: GalleryJobSettings = {
    workspaceSlug: workspace?.slug,
    sessionName: session.name,
    provider,
    galleryRunId: runId,
    targetIds,
    targetPhases: Object.fromEntries(targetPhases),
    previousStatus: Object.fromEntries(previousStatus),
    ownerUserId,
    actorUserId: auth.user.id,
    estimatedCredits,
    runtimeSettings,
  };
  const job = await insertJobRun(auth.admin, {
    workspaceId,
    kind: "gallery",
    sessionId,
    createdBy: auth.user.id,
    targetIds,
    settings: jobSettings,
  });
  await dispatchJob(job.id, "gallery");

  const { data: updatedSession } = await auth.admin
    .from("gallery_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  galleryLog("generate:accepted", "Background gallery run started", {
    runId,
    jobId: job.id,
    provider,
    rowCount: targetIds.length,
    galleryImagesPerRow:
      provider === "ai"
        ? runtimeSettings.ai.imagesPerRow
        : runtimeSettings.scraping.imagesPerRow,
    mainImagesPerRow:
      provider === "ai"
        ? runtimeSettings.ai.main.imagesPerRow
        : runtimeSettings.scraping.main.imagesPerRow,
  });

  return NextResponse.json(
    {
      runId,
      jobId: job.id,
      status: "running",
      completed: 0,
      failed: 0,
      usedCredits: 0,
      estimatedCredits,
      estimateRange,
      worksheet,
      session: updatedSession as GallerySession,
      signedUrls: await signGalleryWorksheetImages(worksheet),
    },
    { status: 202, headers: auth.headers }
  );
}
