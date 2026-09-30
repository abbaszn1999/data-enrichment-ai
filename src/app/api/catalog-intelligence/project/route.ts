import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext } from "@/lib/workspace-context";
import {
  loadProjectJsonAdmin,
  saveProjectDeltaAdmin,
  saveProjectJsonAdmin,
} from "@/lib/jobs/project-json";
import type { ProjectJson, ProjectRow } from "@/lib/storage-helpers";

/** Rows one delta save may carry; a bigger change is a full save. */
const MAX_DELTA_ROWS = 2000;

async function requireSessionMember(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("catalog_sessions")
    .select("id, workspace_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return { error: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  }
  const ctx = await getWorkspaceContext({
    workspaceId: session.workspace_id,
    userId: user.id,
  });
  if (!ctx.membershipRole) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, ctx, session, admin };
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!sessionId || !workspaceId) {
    return NextResponse.json(
      { error: "workspaceId and sessionId are required" },
      { status: 400 }
    );
  }
  const auth = await requireSessionMember(sessionId);
  if ("error" in auth) return auth.error;
  if (auth.session.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const project = await loadProjectJsonAdmin(workspaceId, sessionId, auth.admin);
    if (!project) {
      return NextResponse.json({ error: "Project data not found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let body: { workspaceId?: string; sessionId?: string; project?: ProjectJson };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceId = body.workspaceId?.trim();
  const sessionId = body.sessionId?.trim();
  if (!workspaceId || !sessionId || !body.project) {
    return NextResponse.json(
      { error: "workspaceId, sessionId, and project are required" },
      { status: 400 }
    );
  }
  const auth = await requireSessionMember(sessionId);
  if ("error" in auth) return auth.error;
  if (auth.ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (auth.session.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    await saveProjectJsonAdmin(workspaceId, sessionId, body.project, auth.admin);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Delta autosave: only the rows that changed since the last save (plus the
 * sheet settings when those changed). Answers 409 `FULL_SAVE_REQUIRED` when
 * the change is structural, so the client falls back to the full PUT.
 */
export async function PATCH(request: NextRequest) {
  let body: {
    workspaceId?: string;
    sessionId?: string;
    rows?: ProjectRow[];
    rowCount?: number;
    meta?: Omit<ProjectJson, "rows">;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceId = body.workspaceId?.trim();
  const sessionId = body.sessionId?.trim();
  if (!workspaceId || !sessionId || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "workspaceId, sessionId, and rows are required" }, { status: 400 });
  }
  if (body.rows.length > MAX_DELTA_ROWS) {
    return NextResponse.json({ code: "FULL_SAVE_REQUIRED", error: "Too many changed rows" }, { status: 409 });
  }
  const auth = await requireSessionMember(sessionId);
  if ("error" in auth) return auth.error;
  if (auth.ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (auth.session.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = body.rows.filter((row) => row && typeof row.id === "string" && row.id.length > 0);
  if (rows.length !== body.rows.length) {
    return NextResponse.json({ error: "Every row needs an id" }, { status: 400 });
  }
  try {
    const result = await saveProjectDeltaAdmin({
      workspaceId,
      sessionId,
      rows,
      expectedRowCount: typeof body.rowCount === "number" ? body.rowCount : undefined,
      meta: body.meta,
      admin: auth.admin,
    });
    if (!result.ok) {
      return NextResponse.json({ code: "FULL_SAVE_REQUIRED", error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, patched: result.patched });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
