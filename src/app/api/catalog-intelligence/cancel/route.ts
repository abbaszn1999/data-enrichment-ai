import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { loadActiveJobForSession, loadJobRun, requestJobCancel } from "@/lib/jobs/repo";
import { forceFinishCatalogRun, isCatalogWorkerStale } from "@/lib/jobs/catalog-recovery";

/**
 * Stop: no new row starts from this moment. Rows already sent to the AI finish
 * (a research loop wraps up at its next round), their results are saved and
 * charged, and the orchestrator then ends the run as cancelled — the status
 * poll shows that live. If the orchestrator is already gone (deploy, restart,
 * crash), nobody is left to do that, so the run is finished here immediately
 * from what is actually saved.
 */
export async function POST(request: NextRequest) {
  let body: { workspaceId?: string; sessionId?: string; runId?: string };
  try {
    body = (await request.json()) as { workspaceId?: string; sessionId?: string; runId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
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
  if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  let runId = body.runId?.trim();
  if (!runId && body.sessionId) {
    const active = await loadActiveJobForSession(admin, {
      kind: "catalog",
      sessionId: body.sessionId,
      workspaceId,
    });
    runId = active?.id;
  }
  if (!runId) {
    return NextResponse.json({ error: "No active run" }, { status: 404 });
  }

  const existing = await loadJobRun(admin, runId);
  if (!existing || existing.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const requested = (await requestJobCancel(admin, runId, workspaceId)) ?? existing;
  // A run still waiting for a free slot has nothing in flight to wait for, so
  // Stop ends it right away instead of leaving it "stopping" until Render gets
  // round to starting it. (If a worker starts in that instant, the guarded
  // write does nothing and the worker sees the Stop flag itself.)
  const neverStarted = requested.status === "queued";
  const run =
    neverStarted || isCatalogWorkerStale(requested)
      ? await forceFinishCatalogRun(admin, requested, neverStarted ? { onlyIfQueued: true } : undefined)
      : requested;
  return NextResponse.json({ ok: true, run });
}
