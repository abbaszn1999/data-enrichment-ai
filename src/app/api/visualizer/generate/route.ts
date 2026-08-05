import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import { processDescriptionRow } from "@/lib/visualizer/process-description-row";
import { processImagesRow } from "@/lib/visualizer/process-images-row";
import {
  estimateDescriptionCredits,
  estimateImageCredits,
} from "@/lib/visualizer/pricing";
import { validateVisualizerSettings } from "@/lib/visualizer/row-fields";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import {
  loadVisualizerWorksheetAdmin,
  loadVisualizerWorksheetMatchingRevisionAdmin,
  saveVisualizerResultsAdmin,
  saveVisualizerWorksheetAdmin,
  signVisualizerWorksheetImages,
} from "@/lib/visualizer/storage-admin";
import { recoverVisualizerFailedRun } from "@/lib/visualizer/session-heal";
import { visualizerError, visualizerLog, visualizerWarn } from "@/lib/visualizer/log";
import { withVisualizerWorksheetLock } from "@/lib/visualizer/worksheet-lock";
import {
  applyVisualizerProjectSettings,
  normalizeVisualizerWorksheet,
  type VisualizerPhase,
  type VisualizerProjectSettings,
  type VisualizerRow,
  type VisualizerRowStatus,
  type VisualizerSession,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

export const maxDuration = 300;

type Body = {
  workspaceId?: string;
  sessionId?: string;
  phase?: VisualizerPhase;
  rowIds?: string[];
  settingsSnapshot?: VisualizerProjectSettings;
  worksheetSnapshot?: VisualizerWorksheetJson;
  worksheetRevision?: number;
  estimateOnly?: boolean;
  retryFailed?: boolean;
};

function rowCounts(worksheet: VisualizerWorksheetJson) {
  return {
    ready: worksheet.rows.filter(
      (row) =>
        row.status === "description_ready" || row.status === "images_ready"
    ).length,
    failed: worksheet.rows.filter((row) => row.status === "failed").length,
  };
}

function selectTargetIds(
  worksheet: VisualizerWorksheetJson,
  phase: VisualizerPhase,
  body: Body
): string[] {
  let targetIds = body.rowIds?.length ? [...new Set(body.rowIds)] : [];
  if (body.retryFailed) {
    const failedIds = new Set(
      worksheet.rows.filter((row) => row.status === "failed").map((row) => row.id)
    );
    targetIds = targetIds.length
      ? targetIds.filter((id) => failedIds.has(id))
      : [...failedIds];
    return targetIds;
  }
  if (targetIds.length > 0) return targetIds;

  if (phase === "description") {
    return worksheet.rows
      .filter(
        (row) => row.status === "not_started" || row.status === "failed"
      )
      .map((row) => row.id);
  }

  return worksheet.rows
    .filter(
      (row) =>
        row.status === "description_ready" ||
        (row.status === "failed" && !!row.generatedDescription)
    )
    .map((row) => row.id);
}

export async function POST(request: NextRequest) {
  const recovery = (await request
    .clone()
    .json()
    .catch(() => null)) as Body | null;
  try {
    return await generateSynchronously(request);
  } catch (error) {
    visualizerError("generate", "Visualizer generation failed", error);
    if (recovery?.workspaceId && recovery.sessionId) {
      try {
        await recoverVisualizerFailedRun({
          workspaceId: recovery.workspaceId,
          sessionId: recovery.sessionId,
          errorMessage:
            error instanceof Error ? error.message : "Generation failed",
        });
      } catch (recoveryError) {
        visualizerError(
          "generate:recovery",
          "Could not recover failed run",
          recoveryError
        );
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

  const phase: VisualizerPhase =
    body.phase === "images" ? "images" : "description";

  if (phase === "description" && !process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          "Description generation is temporarily unavailable. Contact your administrator.",
      },
      { status: 503 }
    );
  }
  if (phase === "images" && !process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          "Image generation is temporarily unavailable. Contact your administrator.",
      },
      { status: 503 }
    );
  }

  const auth = await requireVisualizerAuth({
    workspaceId,
    requireWrite: true,
    requireCredits: true,
  });
  if (!auth.ok) return auth.response;

  const { data: session, error: sessionError } = await auth.admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (sessionError || !session) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }

  const loadedWorksheet = await loadVisualizerWorksheetAdmin(
    workspaceId,
    sessionId
  );
  if (!loadedWorksheet) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      { status: 409, headers: { ...auth.headers, "Retry-After": "2" } }
    );
  }

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

  let worksheet = normalizeVisualizerWorksheet(body.worksheetSnapshot);
  let runtimeSettings: VisualizerProjectSettings;
  try {
    runtimeSettings = parseVisualizerProjectSettings(body.settingsSnapshot);
  } catch {
    return NextResponse.json(
      { error: "A valid settingsSnapshot is required" },
      { status: 400, headers: auth.headers }
    );
  }

  const mappingError = validateVisualizerSettings(
    runtimeSettings,
    worksheet.columns
  );
  if (mappingError) {
    return NextResponse.json(
      { error: mappingError },
      { status: 400, headers: auth.headers }
    );
  }

  worksheet = applyVisualizerProjectSettings(worksheet, runtimeSettings);
  const targetIds = selectTargetIds(worksheet, phase, body);

  if (targetIds.length === 0) {
    return NextResponse.json(
      {
        error:
          phase === "images"
            ? "No description-ready rows selected for image generation"
            : "No rows selected for description generation",
      },
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

  if (phase === "images") {
    const notReady = targetIds.filter((id) => {
      const row = rowsById.get(id)!;
      return !row.generatedDescription || !(row.imagePlaceholders?.length);
    });
    if (notReady.length > 0) {
      return NextResponse.json(
        {
          error:
            "Selected rows need a generated description with placeholders before images",
        },
        { status: 400, headers: auth.headers }
      );
    }
  }

  const estimateRange =
    phase === "description"
      ? estimateDescriptionCredits({
          rowCount: targetIds.length,
          tier: runtimeSettings.description.tier,
        })
      : estimateImageCredits({
          placeholderCount: targetIds.reduce(
            (sum, id) =>
              sum + (rowsById.get(id)?.imagePlaceholders?.length || 0),
            0
          ),
          images: runtimeSettings.images,
        });
  const estimatedCredits = estimateRange.max;

  if (body.estimateOnly) {
    return NextResponse.json(
      {
        estimatedCredits,
        estimateRange,
        remaining: auth.ctx.credits.total,
        rowCount: targetIds.length,
        phase,
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
    "claim_visualizer_session_run",
    {
      p_session_id: sessionId,
      p_workspace_id: workspaceId,
      p_phase: phase,
    }
  );
  if (claimError) throw claimError;
  if (!claimed) {
    return NextResponse.json(
      { error: "A generation run is already in progress" },
      { status: 409, headers: auth.headers }
    );
  }

  worksheet.activeRun = {
    id: runId,
    phase,
    status: "running",
    selectedRowIds: targetIds,
    total: targetIds.length,
    completed: 0,
    failed: 0,
    estimatedCredits,
    usedCredits: 0,
    cancelRequested: false,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const { data: revRow, error: revReadError } = await auth.admin
    .from("visualizer_sessions")
    .select("worksheet_revision")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (revReadError) throw revReadError;
  let expectedRevision = Number(revRow?.worksheet_revision ?? 0);
  const { data: nextRevision, error: revisionError } = await auth.admin.rpc(
    "claim_visualizer_worksheet_revision",
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
  expectedRevision = Number(nextRevision);
  await saveVisualizerWorksheetAdmin(
    workspaceId,
    sessionId,
    worksheet,
    expectedRevision
  );

  const ownerUserId = auth.ctx.subscription!.user_id as string;
  let completed = 0;
  let failed = 0;
  let usedCredits = 0;
  let usedCost = 0;
  let cancelled = false;
  let worksheetWriteQueue: Promise<void> = Promise.resolve();
  const previousStatus = new Map<string, VisualizerRowStatus>(
    targetIds.map((id) => [id, rowsById.get(id)!.status])
  );

  // Mark selected rows queued for UI before workers start.
  for (const rowId of targetIds) {
    const index = worksheet.rows.findIndex((row) => row.id === rowId);
    if (index < 0) continue;
    worksheet.rows[index] = {
      ...worksheet.rows[index]!,
      status: "generating",
      errorMessage: undefined,
    };
  }
  await saveVisualizerWorksheetAdmin(
    workspaceId,
    sessionId,
    worksheet,
    expectedRevision
  );

  const persistRevision = async () => {
    const { data: claimedRevision, error } = await auth.admin.rpc(
      "claim_visualizer_worksheet_revision",
      {
        p_session_id: sessionId,
        p_workspace_id: workspaceId,
        p_expected_revision: expectedRevision,
      }
    );
    if (error) throw error;
    if (claimedRevision === null || claimedRevision === undefined) {
      const stored = await loadVisualizerWorksheetMatchingRevisionAdmin(
        workspaceId,
        sessionId,
        expectedRevision
      );
      if (stored) {
        const byId = new Map(worksheet.rows.map((row) => [row.id, row]));
        worksheet = {
          ...stored,
          settings: worksheet.settings,
          activeRun: worksheet.activeRun,
          rows: stored.rows.map((row) => byId.get(row.id) ?? row),
        };
      }
      const { data: latest } = await auth.admin
        .from("visualizer_sessions")
        .select("worksheet_revision")
        .eq("id", sessionId)
        .eq("workspace_id", workspaceId)
        .single();
      expectedRevision = Number(latest?.worksheet_revision ?? expectedRevision);
      const { data: retryRevision, error: retryError } = await auth.admin.rpc(
        "claim_visualizer_worksheet_revision",
        {
          p_session_id: sessionId,
          p_workspace_id: workspaceId,
          p_expected_revision: expectedRevision,
        }
      );
      if (retryError) throw retryError;
      if (retryRevision === null || retryRevision === undefined) {
        throw new Error("WORKSHEET_REVISION_CONFLICT");
      }
      expectedRevision = Number(retryRevision);
    } else {
      expectedRevision = Number(claimedRevision);
    }
    worksheet.revision = expectedRevision;
    await saveVisualizerWorksheetAdmin(
      workspaceId,
      sessionId,
      worksheet,
      expectedRevision
    );
  };

  const commitWorksheet = (
    mutate: () => void | Promise<void>
  ): Promise<void> => {
    const operation = worksheetWriteQueue.then(async () => {
      await withVisualizerWorksheetLock(workspaceId, sessionId, async () => {
        await mutate();
        await persistRevision();
      });
    });
    worksheetWriteQueue = operation.catch(() => undefined);
    return operation;
  };

  const cancellationRequested = async () => {
    const { data, error } = await auth.admin
      .from("visualizer_sessions")
      .select("cancel_requested")
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId)
      .single();
    if (error) throw error;
    return Boolean(data?.cancel_requested);
  };

  const writeResults = async (options?: { signImages?: boolean }) => {
    try {
      const shouldSign = phase === "images" && options?.signImages !== false;
      const signed = shouldSign
        ? await signVisualizerWorksheetImages(worksheet, 60 * 60 * 24 * 7).catch(
            (error) => {
              visualizerWarn(
                "generate:results",
                "Could not sign images for results.xlsx; saving storage paths",
                {
                  error:
                    error instanceof Error ? error.message : String(error),
                }
              );
              return {} as Record<string, string>;
            }
          )
        : {};
      await saveVisualizerResultsAdmin(
        workspaceId,
        sessionId,
        worksheet,
        signed
      );
    } catch (resultsError) {
      visualizerError(
        "generate:results",
        "Failed to update results.xlsx",
        resultsError
      );
    }
  };

  visualizerLog("generate", `Starting ${phase} phase`, {
    sessionId,
    runId,
    rowCount: targetIds.length,
    concurrency: Math.min(3, targetIds.length),
  });

  let nextTargetIndex = 0;
  let stopObserved = false;
  const worker = async () => {
    while (true) {
      if (stopObserved || (await cancellationRequested())) {
        stopObserved = true;
        cancelled = true;
        return;
      }
      const targetIndex = nextTargetIndex;
      nextTargetIndex += 1;
      if (targetIndex >= targetIds.length) return;
      const rowId = targetIds[targetIndex]!;

      let claimedRow: VisualizerRow | null = null;
      await commitWorksheet(() => {
        const index = worksheet.rows.findIndex((row) => row.id === rowId);
        if (index < 0) {
          claimedRow = null;
          return;
        }
        worksheet.rows[index] = {
          ...worksheet.rows[index]!,
          status: "generating",
          errorMessage: undefined,
        };
        if (worksheet.activeRun) {
          worksheet.activeRun.currentRowId = rowId;
          worksheet.activeRun.updatedAt = new Date().toISOString();
        }
        claimedRow = structuredClone(worksheet.rows[index]!) as VisualizerRow;
      });
      if (!claimedRow) continue;
      const inputRow: VisualizerRow = claimedRow;

      let result: Awaited<ReturnType<typeof processDescriptionRow>>;
      try {
        result =
          phase === "description"
            ? await processDescriptionRow({
                admin: auth.admin,
                workspaceId,
                sessionId,
                worksheet: structuredClone(worksheet),
                row: inputRow,
                settings: runtimeSettings,
                ownerUserId,
                actorUserId: auth.user.id,
                runId,
              })
            : await processImagesRow({
                admin: auth.admin,
                workspaceId,
                sessionId,
                worksheet: structuredClone(worksheet),
                row: inputRow,
                settings: runtimeSettings,
                ownerUserId,
                actorUserId: auth.user.id,
                runId,
                shouldCancel: cancellationRequested,
              });
      } catch (error) {
        result = {
          row: {
            ...inputRow,
            status: "failed",
            errorMessage:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Row processing failed",
          },
          creditsUsed: 0,
          cost: 0,
          error:
            error instanceof Error ? error.message : "Row processing failed",
        };
      }

      await commitWorksheet(() => {
        const index = worksheet.rows.findIndex((row) => row.id === rowId);
        if (index >= 0) {
          worksheet.rows[index] = result.row;
        }
        const successStatus =
          phase === "description" ? "description_ready" : "images_ready";
        if (result.row.status === successStatus) {
          completed += 1;
          usedCredits += result.creditsUsed;
          usedCost += result.cost;
        } else if (
          phase === "images" &&
          result.row.status === "description_ready"
        ) {
          // Stopped after finishing in-flight image requests; keep progress, not a failure.
          usedCredits += result.creditsUsed;
          usedCost += result.cost;
        } else {
          failed += 1;
        }
        if (worksheet.activeRun) {
          worksheet.activeRun.completed = completed;
          worksheet.activeRun.failed = failed;
          worksheet.activeRun.usedCredits = usedCredits;
          worksheet.activeRun.updatedAt = new Date().toISOString();
        }
      });
      await writeResults({ signImages: false });

      // Cooperative stop: finish the in-flight product/request, then do not claim
      // another product after the cancellation flag becomes visible.
      if (await cancellationRequested()) {
        stopObserved = true;
        cancelled = true;
        return;
      }
    }
  };

  const workerCount = Math.min(3, targetIds.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  // Drain in-flight worksheet writes before marking the run terminal (gallery parity).
  await worksheetWriteQueue.catch(() => undefined);

  // Cooperative stop: never clobber rows that finished (or are still settling).
  // Unclaimed targets were never moved off their previous status.
  const markRunCancelled = () => {
    if (!worksheet.activeRun) return;
    worksheet.activeRun.cancelRequested = true;
    worksheet.activeRun.status = "cancelled";
    worksheet.activeRun.finishedAt = new Date().toISOString();
    worksheet.activeRun.currentRowId = null;
  };

  const counts = rowCounts(worksheet);
  let finalStatus: VisualizerSession["status"] = "paused";
  let awaiting = true;
  let errorMessage: string | null = null;

  if (cancelled || stopObserved || (await cancellationRequested())) {
    cancelled = true;
    markRunCancelled();
    if (phase === "images") {
      const anyImagesReady = worksheet.rows.some(
        (row) => row.status === "images_ready"
      );
      finalStatus = anyImagesReady ? "completed" : "paused";
      awaiting = !anyImagesReady;
    } else {
      finalStatus = completed > 0 ? "paused" : "ready";
      awaiting = completed > 0;
    }
  } else if (completed === 0 && failed > 0) {
    if (worksheet.activeRun) {
      worksheet.activeRun.status = "failed";
      worksheet.activeRun.finishedAt = new Date().toISOString();
      worksheet.activeRun.currentRowId = null;
      worksheet.activeRun.errorMessage = "All selected rows failed";
    }
    finalStatus = "failed";
    awaiting = false;
    errorMessage = "All selected rows failed";
  } else if (phase === "images") {
    if (worksheet.activeRun) {
      worksheet.activeRun.status = "completed";
      worksheet.activeRun.finishedAt = new Date().toISOString();
      worksheet.activeRun.currentRowId = null;
    }
    finalStatus = "completed";
    awaiting = false;
  } else {
    if (worksheet.activeRun) {
      worksheet.activeRun.status = "completed";
      worksheet.activeRun.finishedAt = new Date().toISOString();
      worksheet.activeRun.currentRowId = null;
    }
    finalStatus = "paused";
    awaiting = true;
  }

  await persistRevision();
  await writeResults();

  await auth.admin.rpc("add_visualizer_session_usage", {
    p_session_id: sessionId,
    p_workspace_id: workspaceId,
    p_credits: usedCredits,
    p_cost: usedCost,
    p_ready_rows: counts.ready,
    p_failed_rows: counts.failed,
    p_status: finalStatus,
    p_error_message: errorMessage,
    p_awaiting_user_action: awaiting,
    p_active_phase:
      finalStatus === "paused"
        ? "description"
        : finalStatus === "completed"
          ? "images"
          : phase,
  });

  await auth.admin
    .from("visualizer_sessions")
    .update({ cancel_requested: false })
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId);

  const { data: updatedSession } = await auth.admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();

  const signedUrls =
    phase === "images"
      ? await signVisualizerWorksheetImages(worksheet).catch(() => ({}))
      : {};

  return NextResponse.json(
    {
      runId,
      status: finalStatus,
      phase,
      completed,
      failed,
      usedCredits,
      estimatedCredits,
      estimateRange,
      remaining: auth.ctx.credits.total - usedCredits,
      worksheet,
      session: updatedSession,
      signedUrls,
      message:
        phase === "images"
          ? finalStatus === "completed"
            ? "Images embedded. Project completed."
            : cancelled
              ? "Image generation stopped"
              : undefined
          : awaiting
            ? "Descriptions ready for review. Approve before generating images."
            : cancelled
              ? "Description generation stopped"
              : undefined,
    },
    { headers: auth.headers }
  );
}
