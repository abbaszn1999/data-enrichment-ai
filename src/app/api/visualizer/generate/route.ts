import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import {
  estimateDescriptionCredits,
  estimateImageCredits,
} from "@/lib/visualizer/pricing";
import { validateVisualizerSettings } from "@/lib/visualizer/row-fields";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import {
  loadVisualizerWorksheetAdmin,
  saveVisualizerWorksheetAdmin,
} from "@/lib/visualizer/storage-admin";
import { recoverVisualizerFailedRun } from "@/lib/visualizer/session-heal";
import { visualizerError, visualizerLog } from "@/lib/visualizer/log";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { insertJobRun } from "@/lib/jobs/repo";
import type { VisualizerJobSettings } from "@/lib/jobs/visualizer-settings";
import {
  applyVisualizerProjectSettings,
  normalizeVisualizerWorksheet,
  type VisualizerPhase,
  type VisualizerProjectSettings,
  type VisualizerRowStatus,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

export const maxDuration = 60;

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

  if (phase === "images") {
    return worksheet.rows
      .filter(
        (row) =>
          row.status === "description_ready" ||
          (row.status === "failed" && !!row.generatedDescription)
      )
      .map((row) => row.id);
  }

  // description + full: start from rows that still need a description pass
  return worksheet.rows
    .filter(
      (row) => row.status === "not_started" || row.status === "failed"
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
    body.phase === "images"
      ? "images"
      : body.phase === "full"
        ? "full"
        : "description";

  const needsOpenAI = phase === "description" || phase === "full";
  const needsGemini = phase === "images" || phase === "full";

  if (needsOpenAI && !process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          "Description generation is temporarily unavailable. Contact your administrator.",
      },
      { status: 503 }
    );
  }
  if (needsGemini && !process.env.GEMINI_API_KEY?.trim()) {
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
            : phase === "full"
              ? "No rows selected for generation"
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

  const expectedPlaceholdersPerRow = Math.max(
    1,
    Number(runtimeSettings.description.imageCount) || 4
  );
  const descriptionEstimate =
    phase === "description" || phase === "full"
      ? estimateDescriptionCredits({
          rowCount: targetIds.length,
          tier: runtimeSettings.description.tier,
        })
      : { min: 0, max: 0 };
  const imagePlaceholderCount =
    phase === "images"
      ? targetIds.reduce(
          (sum, id) =>
            sum + (rowsById.get(id)?.imagePlaceholders?.length || 0),
          0
        )
      : phase === "full"
        ? targetIds.length * expectedPlaceholdersPerRow
        : 0;
  const imageEstimate =
    phase === "images" || phase === "full"
      ? estimateImageCredits({
          placeholderCount: imagePlaceholderCount,
          images: runtimeSettings.images,
        })
      : { min: 0, max: 0 };
  const estimateRange = {
    min: descriptionEstimate.min + imageEstimate.min,
    max: descriptionEstimate.max + imageEstimate.max,
  };
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
      generationStage:
        phase === "images" ? "images" : "description",
      errorMessage: undefined,
    };
  }
  await saveVisualizerWorksheetAdmin(
    workspaceId,
    sessionId,
    worksheet,
    expectedRevision
  );

  const { data: workspace } = await auth.admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .single();

  const jobSettings: VisualizerJobSettings = {
    workspaceSlug: workspace?.slug,
    sessionName: session.name,
    phase,
    visualizerRunId: runId,
    targetIds,
    previousStatus: Object.fromEntries(previousStatus),
    ownerUserId,
    actorUserId: auth.user.id,
    estimatedCredits,
    runtimeSettings,
  };
  const job = await insertJobRun(auth.admin, {
    workspaceId,
    kind: "visualizer",
    sessionId,
    createdBy: auth.user.id,
    targetIds,
    settings: jobSettings,
  });
  await dispatchJob(job.id, "visualizer");

  const { data: updatedSession } = await auth.admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();

  visualizerLog("generate:accepted", "Background visualizer run started", {
    runId,
    jobId: job.id,
    phase,
    rowCount: targetIds.length,
  });

  return NextResponse.json(
    {
      runId,
      jobId: job.id,
      status: "running",
      phase,
      completed: 0,
      failed: 0,
      usedCredits: 0,
      estimatedCredits,
      estimateRange,
      remaining: auth.ctx.credits.total,
      worksheet,
      session: updatedSession,
      signedUrls: {},
      message: "Generation started in the background",
    },
    { status: 202, headers: auth.headers }
  );
}
