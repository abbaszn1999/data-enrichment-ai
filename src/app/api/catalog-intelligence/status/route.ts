import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { loadActiveJobForSession, loadJobRun } from "@/lib/jobs/repo";
import { loadProjectJsonAdmin } from "@/lib/jobs/project-json";
import { recoverStaleCatalogRun } from "@/lib/jobs/catalog-recovery";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
  const runId = request.nextUrl.searchParams.get("runId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const loaded = runId
    ? await loadJobRun(admin, runId)
    : sessionId
      ? await loadActiveJobForSession(admin, {
          kind: "catalog",
          sessionId,
          workspaceId,
        })
      : null;

  if (loaded && loaded.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // A run whose orchestrator died (deploy, restart, crash) is resumed — or,
  // if Stop was pressed, finished — right here, so the page never shows a
  // frozen run. The background sweep does the same when nobody is watching.
  let run = loaded;
  if (run && run.kind === "catalog") {
    try {
      run = await recoverStaleCatalogRun(admin, run);
    } catch (error) {
      console.error("[catalog-intelligence/status] stale-run recovery failed", error);
    }
  }

  const project =
    sessionId || run
      ? await loadProjectJsonAdmin(workspaceId, sessionId || run!.session_id, admin)
      : null;

  return NextResponse.json({
    run,
    project,
  });
}
