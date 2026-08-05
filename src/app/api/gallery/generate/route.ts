import { NextRequest, NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { processScrapingRow } from "@/lib/gallery/agent/process-row";
import { processAiRow } from "@/lib/gallery/agent/process-ai-row";
import {
  estimateGalleryCredits,
  estimateScrapingCreditRange,
} from "@/lib/gallery/pricing";
import {
  loadGalleryWorksheetAdmin,
  loadGalleryWorksheetConsistentAdmin,
  loadGalleryWorksheetMatchingRevisionAdmin,
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
import {
  applyGenerationRowPatch,
  reconcileGenerationWorksheet,
} from "@/lib/gallery/generation-worksheet-merge";
import type {
  GalleryProjectSettings,
  GalleryProvider,
  GalleryRow,
  GalleryRunPhase,
  GallerySession,
  GalleryWorksheetJson,
} from "@/lib/gallery/types";
import {
  applyGalleryProjectSettings,
  normalizeGalleryWorksheet,
  resolveGalleryRunPhase,
} from "@/lib/gallery/types";

export const maxDuration = 300;

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

function counts(worksheet: GalleryWorksheetJson) {
  return {
    ready: worksheet.rows.filter((row) => row.status === "ready").length,
    failed: worksheet.rows.filter((row) => row.status === "failed").length,
  };
}

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

  const ownerUserId = auth.ctx.subscription!.user_id as string;
  let completed = 0;
  let failed = 0;
  let usedCredits = 0;
  let usedCost = 0;

  let worksheetWriteQueue: Promise<void> = Promise.resolve();
  /** Storage row snapshot for the current locked commit (user deletes win). */
  let storageRowsById = new Map<string, GalleryRow>();
  const targetRowIdSet = new Set(targetIds);

  const persistWorksheetRevision = async (expectedRevision: number) => {
    let attemptRevision = expectedRevision;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: nextRevision, error: revisionError } = await auth.admin.rpc(
        "claim_gallery_worksheet_revision",
        {
          p_session_id: sessionId,
          p_workspace_id: workspaceId,
          p_expected_revision: attemptRevision,
        }
      );
      if (revisionError) throw revisionError;
      if (nextRevision !== null && nextRevision !== undefined) {
        const claimed = Number(nextRevision);
        worksheet.revision = claimed;
        await saveGalleryWorksheetAdmin(
          workspaceId,
          sessionId,
          worksheet,
          claimed
        );
        return claimed;
      }
      const { data: revRow, error: revReadError } = await auth.admin
        .from("gallery_sessions")
        .select("worksheet_revision")
        .eq("id", sessionId)
        .eq("workspace_id", workspaceId)
        .single();
      if (revReadError) throw revReadError;
      attemptRevision = Number(revRow?.worksheet_revision ?? attemptRevision);
    }
    throw new Error("WORKSHEET_REVISION_CONFLICT");
  };

  const commitWorksheet = (
    mutate: () => void | Promise<void>
  ): Promise<void> => {
    const operation = worksheetWriteQueue.then(async () => {
      await withGalleryWorksheetLock(workspaceId, sessionId, async () => {
        const { data: revRow, error: revReadError } = await auth.admin
          .from("gallery_sessions")
          .select("worksheet_revision, total_rows")
          .eq("id", sessionId)
          .eq("workspace_id", workspaceId)
          .single();
        if (revReadError) throw revReadError;
        const dbRevision = Number(revRow?.worksheet_revision ?? 0);
        const expectedRows = Number(revRow?.total_rows ?? worksheet.rows.length);
        const stored = await loadGalleryWorksheetMatchingRevisionAdmin(
          workspaceId,
          sessionId,
          dbRevision
        );
        if (stored && stored.rows.length === expectedRows) {
          storageRowsById = new Map(stored.rows.map((row) => [row.id, row]));
          worksheet = reconcileGenerationWorksheet({
            memory: worksheet,
            storage: stored,
            targetRowIds: targetRowIdSet,
          });
        } else {
          storageRowsById = new Map(
            worksheet.rows.map((row) => [row.id, row])
          );
        }

        await mutate();
        await persistWorksheetRevision(dbRevision);
      });
    });
    worksheetWriteQueue = operation.catch(() => undefined);
    return operation;
  };

  const patchRowDuringRun = (rowId: string, patch: Partial<GalleryRow>) => {
    const index = worksheet.rows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    const memoryRow = worksheet.rows[index];
    const storageRow = storageRowsById.get(rowId) ?? memoryRow;
    worksheet.rows[index] = applyGenerationRowPatch({
      storageRow,
      memoryRow,
      patch,
    });
  };

  const checkpoint = async (rowId: string, patch: Partial<GalleryRow>) => {
    await commitWorksheet(() => {
      patchRowDuringRun(rowId, patch);
    });
  };

  const cancellationRequested = async () => {
    const { data, error } = await auth.admin
      .from("gallery_sessions")
      .select("cancel_requested")
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId)
      .single();
    if (error) throw error;
    return Boolean(data?.cancel_requested);
  };

  const markRunCancelled = () => {
    if (!worksheet.activeRun) return;
    worksheet.activeRun.cancelRequested = true;
    worksheet.activeRun.status = "cancelled";
    worksheet.activeRun.finishedAt = new Date().toISOString();
    for (const row of worksheet.rows) {
      if (targetIds.includes(row.id) && row.status === "queued") {
        row.status = "not_started";
        row.generationStage = undefined;
        row.generationTarget = undefined;
      }
    }
  };

  let nextTargetIndex = 0;
  let stopObserved = false;
  const worker = async () => {
    while (true) {
      if (stopObserved || (await cancellationRequested())) {
        stopObserved = true;
        return;
      }
      const targetIndex = nextTargetIndex;
      nextTargetIndex += 1;
      if (targetIndex >= targetIds.length) return;
      const rowId = targetIds[targetIndex];
      const runPhase = targetPhases.get(rowId) ?? "full";

      await commitWorksheet(() => {
        patchRowDuringRun(rowId, {
          status: "generating",
          generationStage: "planning",
          generationTarget: runPhase,
          errorMessage: undefined,
        });
      });
      const rowIndex = worksheet.rows.findIndex((row) => row.id === rowId);
      if (rowIndex < 0) continue;
      const inputRow = structuredClone(worksheet.rows[rowIndex]);

      let result: Awaited<ReturnType<typeof processScrapingRow>>;
      try {
        const shared = {
          workspaceId,
          sessionId,
          worksheet: structuredClone(worksheet),
          row: inputRow,
          ownerUserId,
          actorUserId: auth.user.id,
          runId,
          runPhase,
          onCheckpoint: (patch: Partial<GalleryRow>) =>
            checkpoint(rowId, patch),
        };
        result =
          provider === "ai"
            ? await processAiRow(shared)
            : await processScrapingRow({ admin: auth.admin, ...shared });
      } catch (error) {
        result = {
          row: {
            ...inputRow,
            status:
              previousStatus.get(rowId) === "ready" ? "ready" : "failed",
            generationStage: undefined,
            generationTarget: undefined,
            errorMessage:
              error instanceof Error ? error.message : "Row processing failed",
          },
          creditsUsed: 0,
          cost: 0,
          error:
            error instanceof Error ? error.message : "Row processing failed",
        };
      }

      if (
        previousStatus.get(rowId) === "ready" &&
        result.row.status === "failed"
      ) {
        result.row.status = "ready";
      }
      result.row.generationTarget = undefined;
      await commitWorksheet(() => {
        patchRowDuringRun(rowId, {
          status: result.row.status,
          generationStage: result.row.generationStage,
          generationTarget: result.row.generationTarget,
          errorMessage: result.row.errorMessage,
          mainImagePaths: result.row.mainImagePaths,
          mainImagePath: result.row.mainImagePath,
          galleryImagePaths: result.row.galleryImagePaths,
          sourceMeta: result.row.sourceMeta,
          creditsUsed: result.row.creditsUsed,
        });
        usedCredits += result.creditsUsed;
        usedCost += result.cost;
        if (result.row.status === "ready") completed += 1;
        else failed += 1;
        if (worksheet.activeRun) {
          worksheet.activeRun.completed = completed;
          worksheet.activeRun.failed = failed;
          worksheet.activeRun.usedCredits = usedCredits;
        }
      });

      // Cooperative stop: finish all currently active workers, but do not claim
      // another product after the cancellation flag becomes visible.
      if (await cancellationRequested()) {
        stopObserved = true;
        return;
      }
    }
  };

  const workerCount = Math.min(3, targetIds.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  // Drain any in-flight worksheet writes before marking the run terminal.
  await worksheetWriteQueue.catch(() => undefined);

  if (stopObserved || (await cancellationRequested())) {
    markRunCancelled();
  } else if (worksheet.activeRun?.status !== "cancelled") {
    worksheet.activeRun!.status = "completed";
    worksheet.activeRun!.finishedAt = new Date().toISOString();
  }

  // Final reconcile + persist so activeRun cannot stay "running" in Storage.
  await commitWorksheet(() => {
    for (const row of worksheet.rows) {
      if (!targetRowIdSet.has(row.id)) continue;
      if (row.status === "queued") {
        row.status = "not_started";
        row.generationStage = undefined;
        row.generationTarget = undefined;
      } else {
        row.generationStage = undefined;
        row.generationTarget = undefined;
      }
    }
  });

  const totals = counts(worksheet);
  const finalStatus =
    worksheet.activeRun?.status === "cancelled"
      ? "ready"
      : totals.ready === worksheet.rows.length
        ? "completed"
        : totals.ready === 0 && totals.failed > 0
          ? "failed"
          : "ready";

  const { error: usageError } = await auth.admin.rpc("add_gallery_session_usage", {
    p_session_id: sessionId,
    p_workspace_id: workspaceId,
    p_credits: usedCredits,
    p_cost: usedCost,
    p_ready_rows: totals.ready,
    p_failed_rows: totals.failed,
    p_status: finalStatus,
    p_error_message:
      finalStatus === "failed" ? "All processed rows failed" : null,
  });
  if (usageError) throw usageError;
  await auth.admin
    .from("gallery_sessions")
    .update({ cancel_requested: false })
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId);

  const { data: updatedSession } = await auth.admin
    .from("gallery_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  galleryLog("generate:done", "Synchronous gallery run finished", {
    runId,
    provider,
    completed,
    failed,
    usedCredits,
    usedCost,
    finalStatus,
    activeRunStatus: worksheet.activeRun?.status,
  });
  return NextResponse.json(
    {
      runId,
      status: worksheet.activeRun?.status ?? "completed",
      completed,
      failed,
      usedCredits,
      estimatedCredits,
      estimateRange,
      worksheet,
      session: updatedSession as GallerySession,
      signedUrls: await signGalleryWorksheetImages(worksheet),
    },
    { headers: auth.headers }
  );
}
