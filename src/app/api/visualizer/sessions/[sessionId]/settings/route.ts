import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import {
  loadVisualizerWorksheetAdmin,
  loadVisualizerWorksheetMatchingRevisionAdmin,
  saveVisualizerWorksheetAdmin,
} from "@/lib/visualizer/storage-admin";
import {
  applyVisualizerProjectSettings,
  type VisualizerProjectSettings,
  type VisualizerSession,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

type Ctx = { params: Promise<{ sessionId: string }> };

function settingsColumnsExist(
  settings: VisualizerProjectSettings,
  columns: string[]
): boolean {
  if (
    settings.selectedColumns.some((column) => !columns.includes(column))
  ) {
    return false;
  }
  if (
    settings.productImageColumn &&
    !columns.includes(settings.productImageColumn)
  ) {
    return false;
  }
  return true;
}

/** PUT — atomically claim and replace project settings + worksheet. */
export async function PUT(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
    expectedRevision?: number;
    expectedWorksheetRevision?: number;
    settings?: unknown;
    worksheet?: VisualizerWorksheetJson;
  } | null;

  const workspaceId = String(body?.workspaceId || "");
  const expectedRevision = Number(body?.expectedRevision);
  const expectedWorksheetRevision = Number(body?.expectedWorksheetRevision);
  if (
    !workspaceId ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    !Number.isInteger(expectedWorksheetRevision) ||
    expectedWorksheetRevision < 0
  ) {
    return NextResponse.json(
      { error: "workspaceId and valid revisions are required" },
      { status: 400 }
    );
  }

  const auth = await requireVisualizerAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  let settings: VisualizerProjectSettings;
  try {
    settings = parseVisualizerProjectSettings(body?.settings);
  } catch {
    return NextResponse.json(
      { error: "Invalid visualizer settings" },
      { status: 400, headers: auth.headers }
    );
  }

  const suppliedWorksheet = body?.worksheet;
  if (
    !suppliedWorksheet ||
    suppliedWorksheet.sessionId !== sessionId ||
    !Array.isArray(suppliedWorksheet.rows) ||
    !Array.isArray(suppliedWorksheet.columns)
  ) {
    return NextResponse.json(
      { error: "A valid complete worksheet is required" },
      { status: 400, headers: auth.headers }
    );
  }
  if (!settingsColumnsExist(settings, suppliedWorksheet.columns)) {
    return NextResponse.json(
      { error: "One or more selected columns are invalid" },
      { status: 400, headers: auth.headers }
    );
  }

  const { data: current, error: currentError } = await auth.admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (currentError || !current) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }
  const session = current as VisualizerSession;
  if (session.status === "processing") {
    return NextResponse.json(
      { error: "Settings cannot be saved while processing" },
      { status: 409, headers: auth.headers }
    );
  }

  const liveWorksheet =
    (await loadVisualizerWorksheetMatchingRevisionAdmin(
      workspaceId,
      sessionId,
      Number(session.worksheet_revision ?? 0)
    )) ||
    (await loadVisualizerWorksheetAdmin(workspaceId, sessionId));
  if (!liveWorksheet) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      { status: 409, headers: { ...auth.headers, "Retry-After": "2" } }
    );
  }

  const { data: revisions, error: claimError } = await auth.admin.rpc(
    "claim_visualizer_manual_save",
    {
      p_session_id: sessionId,
      p_workspace_id: workspaceId,
      p_expected_settings_revision: expectedRevision,
      p_expected_worksheet_revision: expectedWorksheetRevision,
      p_settings: settings,
    }
  );
  if (claimError) {
    return NextResponse.json(
      { error: claimError.message },
      { status: 500, headers: auth.headers }
    );
  }
  if (!revisions) {
    return NextResponse.json(
      { error: "Settings changed; reload and retry" },
      { status: 409, headers: auth.headers }
    );
  }

  const nextSettingsRevision = Number(
    (revisions as { settingsRevision?: number }).settingsRevision ??
      expectedRevision + 1
  );
  const nextWorksheetRevision = Number(
    (revisions as { worksheetRevision?: number }).worksheetRevision ??
      expectedWorksheetRevision + 1
  );

  const nextWorksheet = applyVisualizerProjectSettings(
    {
      ...suppliedWorksheet,
      rows: liveWorksheet.rows.map((liveRow) => {
        const supplied = suppliedWorksheet.rows.find(
          (row) => row.id === liveRow.id
        );
        return supplied
          ? {
              ...liveRow,
              ...supplied,
              originalData: liveRow.originalData,
            }
          : liveRow;
      }),
      columns: liveWorksheet.columns,
      sessionId,
    },
    settings
  );

  await saveVisualizerWorksheetAdmin(
    workspaceId,
    sessionId,
    nextWorksheet,
    nextWorksheetRevision
  );

  const { data: updated, error: reloadError } = await auth.admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (reloadError || !updated) {
    return NextResponse.json(
      { error: reloadError?.message || "Failed to reload session" },
      { status: 500, headers: auth.headers }
    );
  }

  const refreshed = updated as VisualizerSession;
  refreshed.settings = settings;
  refreshed.settings_revision = nextSettingsRevision;
  refreshed.worksheet_revision = nextWorksheetRevision;

  return NextResponse.json(
    {
      session: refreshed,
      settings,
      worksheet: nextWorksheet,
    },
    { headers: auth.headers }
  );
}
