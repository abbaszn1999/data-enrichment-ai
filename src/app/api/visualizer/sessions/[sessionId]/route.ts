import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  requireVisualizerAuth,
  requireVisualizerAdmin,
} from "@/lib/visualizer/auth";
import {
  loadVisualizerWorksheetMatchingRevisionAdmin,
  removeVisualizerPrefixAdmin,
  saveVisualizerWorksheetAdmin,
  signVisualizerWorksheetImages,
} from "@/lib/visualizer/storage-admin";
import {
  healVisualizerSessionOnRead,
  loadVisualizerWorksheetForRead,
} from "@/lib/visualizer/session-heal";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import {
  applyVisualizerProjectSettings,
  getVisualizerProjectSettingsFromWorksheet,
  type VisualizerProjectSettings,
  type VisualizerSession,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

type Ctx = { params: Promise<{ sessionId: string }> };

async function loadOwnedSession(
  admin: ReturnType<typeof createAdminClient>,
  sessionId: string,
  workspaceId: string
) {
  const { data, error } = await admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error || !data) return null;
  if (data.workspace_id !== workspaceId) return null;
  return data as VisualizerSession;
}

function resolveSessionSettings(
  session: VisualizerSession,
  worksheet: VisualizerWorksheetJson
): VisualizerProjectSettings {
  try {
    return parseVisualizerProjectSettings(session.settings);
  } catch {
    return getVisualizerProjectSettingsFromWorksheet(worksheet);
  }
}

/** GET /api/visualizer/sessions/[sessionId]?workspaceId= */
export async function GET(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireVisualizerAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const session = await loadOwnedSession(auth.admin, sessionId, workspaceId);
  if (!session) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }

  const loaded = await loadVisualizerWorksheetForRead(
    workspaceId,
    sessionId,
    Number(session.worksheet_revision ?? 0)
  );
  if (!loaded.worksheet) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      {
        status: 409,
        headers: { ...auth.headers, "Retry-After": "2" },
      }
    );
  }

  const healed = await healVisualizerSessionOnRead({
    admin: auth.admin,
    workspaceId,
    session,
    worksheet: loaded.worksheet,
    usedFallback: loaded.usedFallback,
  });
  if (healed.stillSyncing) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      {
        status: 409,
        headers: { ...auth.headers, "Retry-After": "2" },
      }
    );
  }
  const liveSession = healed.session;
  const worksheet = healed.worksheet;

  let projectSettings = resolveSessionSettings(liveSession, worksheet);
  const settingsWereMissing =
    !liveSession.settings ||
    typeof liveSession.settings !== "object" ||
    Object.keys(liveSession.settings).length === 0;

  if (settingsWereMissing) {
    projectSettings = getVisualizerProjectSettingsFromWorksheet(worksheet);
    const expectedRevision = Number(liveSession.settings_revision ?? 0);
    const { data: nextRevision, error: migrationError } = await auth.admin.rpc(
      "save_visualizer_session_settings",
      {
        p_session_id: sessionId,
        p_workspace_id: workspaceId,
        p_expected_revision: expectedRevision,
        p_settings: projectSettings,
      }
    );
    if (migrationError) {
      return NextResponse.json(
        { error: migrationError.message },
        { status: 500, headers: auth.headers }
      );
    }
    if (nextRevision === null || nextRevision === undefined) {
      return NextResponse.json(
        { error: "Settings changed while loading; retry" },
        { status: 409, headers: auth.headers }
      );
    }
    liveSession.settings = projectSettings;
    liveSession.settings_revision = Number(nextRevision);
  }

  const hydratedWorksheet = applyVisualizerProjectSettings(
    worksheet,
    projectSettings
  );
  liveSession.settings = projectSettings;

  const includeSignedUrls =
    request.nextUrl.searchParams.get("includeSignedUrls") === "1";
  const signedUrls = includeSignedUrls
    ? await signVisualizerWorksheetImages(hydratedWorksheet).catch(() => ({}))
    : undefined;

  return NextResponse.json(
    {
      session: liveSession,
      worksheet: hydratedWorksheet,
      ...(signedUrls ? { signedUrls } : {}),
    },
    { headers: auth.headers }
  );
}

/** DELETE /api/visualizer/sessions/[sessionId]?workspaceId= — admin+ */
export async function DELETE(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireVisualizerAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  const isAdmin = await requireVisualizerAdmin(workspaceId, auth.user.id);
  if (!isAdmin) {
    return NextResponse.json(
      { error: "Admin required" },
      { status: 403, headers: auth.headers }
    );
  }

  const session = await loadOwnedSession(auth.admin, sessionId, workspaceId);
  if (!session) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }

  const processingIsRecent =
    session.status === "processing" &&
    Date.now() - new Date(session.updated_at).getTime() < 10 * 60 * 1000;
  if (processingIsRecent) {
    return NextResponse.json(
      { error: "Cancel the active run before deleting this project" },
      { status: 409, headers: auth.headers }
    );
  }

  await removeVisualizerPrefixAdmin(workspaceId, sessionId);

  let deleteError: { message: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await auth.admin
      .from("visualizer_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId);
    if (!error) {
      deleteError = null;
      break;
    }
    deleteError = error;
    if (attempt < 3) {
      await new Promise((resolve) =>
        setTimeout(resolve, 400 * 2 ** (attempt - 1))
      );
    }
  }

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message },
      { status: 500, headers: auth.headers }
    );
  }

  return NextResponse.json({ ok: true }, { headers: auth.headers });
}

/** PATCH kept for future row edits; currently updates name only. */
export async function PATCH(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
    name?: string;
    worksheet?: VisualizerWorksheetJson;
  } | null;
  const workspaceId = String(body?.workspaceId || "");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireVisualizerAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  const session = await loadOwnedSession(auth.admin, sessionId, workspaceId);
  if (!session) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }
  if (session.status === "processing") {
    return NextResponse.json(
      { error: "Project cannot be edited while processing" },
      { status: 409, headers: auth.headers }
    );
  }

  const updates: Record<string, unknown> = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 120) {
      return NextResponse.json(
        { error: "Name must be 1–120 characters" },
        { status: 400, headers: auth.headers }
      );
    }
    updates.name = name;
  }

  let worksheet =
    (await loadVisualizerWorksheetMatchingRevisionAdmin(
      workspaceId,
      sessionId,
      Number(session.worksheet_revision ?? 0)
    )) ?? null;

  if (body?.worksheet) {
    if (
      body.worksheet.sessionId !== sessionId ||
      !Array.isArray(body.worksheet.rows) ||
      !Array.isArray(body.worksheet.columns)
    ) {
      return NextResponse.json(
        { error: "Invalid worksheet payload" },
        { status: 400, headers: auth.headers }
      );
    }
    const { data: nextRevision, error: claimError } = await auth.admin.rpc(
      "claim_visualizer_worksheet_revision",
      {
        p_session_id: sessionId,
        p_workspace_id: workspaceId,
        p_expected_revision: Number(session.worksheet_revision ?? 0),
      }
    );
    if (claimError) {
      return NextResponse.json(
        { error: claimError.message },
        { status: 500, headers: auth.headers }
      );
    }
    if (nextRevision === null || nextRevision === undefined) {
      return NextResponse.json(
        { error: "Worksheet changed; reload and retry" },
        { status: 409, headers: auth.headers }
      );
    }
    worksheet = applyVisualizerProjectSettings(
      body.worksheet,
      resolveSessionSettings(session, body.worksheet)
    );
    await saveVisualizerWorksheetAdmin(
      workspaceId,
      sessionId,
      worksheet,
      Number(nextRevision)
    );
    updates.total_rows = worksheet.rows.length;
    updates.worksheet_revision = Number(nextRevision);
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await auth.admin
      .from("visualizer_sessions")
      .update(updates)
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId);
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: auth.headers }
      );
    }
  }

  const refreshed = await loadOwnedSession(auth.admin, sessionId, workspaceId);
  if (!refreshed) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }

  if (!worksheet) {
    worksheet = await loadVisualizerWorksheetMatchingRevisionAdmin(
      workspaceId,
      sessionId,
      Number(refreshed.worksheet_revision ?? 0)
    );
  }

  return NextResponse.json(
    {
      session: refreshed,
      worksheet: worksheet
        ? applyVisualizerProjectSettings(
            worksheet,
            resolveSessionSettings(refreshed, worksheet)
          )
        : null,
    },
    { headers: auth.headers }
  );
}
