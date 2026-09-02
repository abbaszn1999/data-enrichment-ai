import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import { loadActiveJobForSession } from "@/lib/jobs/repo";
import { jsonByteLength, recordResponseBytes } from "@/lib/observability/metrics";
import type { VisualizerSession } from "@/lib/visualizer/types";

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * Slim generation-progress payload. Reads job_runs + visualizer_sessions only —
 * never the worksheet blob and never signed image URLs.
 */
export async function GET(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireVisualizerAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from("visualizer_sessions")
    .select(
      "id, status, total_rows, ready_rows, failed_rows, cancel_requested, worksheet_revision, active_phase, awaiting_user_action"
    )
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }

  const session = data as Pick<
    VisualizerSession,
    | "id"
    | "status"
    | "total_rows"
    | "ready_rows"
    | "failed_rows"
    | "cancel_requested"
    | "worksheet_revision"
    | "active_phase"
    | "awaiting_user_action"
  >;

  const job = await loadActiveJobForSession(auth.admin, {
    kind: "visualizer",
    sessionId,
    workspaceId,
  });

  const running = job && (job.status === "queued" || job.status === "running");
  const body = {
    sessionId: session.id,
    status: session.status,
    total: session.total_rows,
    readyRows: session.ready_rows,
    failedRows: session.failed_rows,
    worksheetRevision: Number(session.worksheet_revision ?? 0),
    cancelRequested: Boolean(session.cancel_requested),
    activePhase: session.active_phase,
    awaitingUserAction: Boolean(session.awaiting_user_action),
    completed: running ? job.completed_count : session.ready_rows,
    failed: running ? job.failed_count : session.failed_rows,
    jobId: job?.id ?? null,
    jobStatus: job?.status ?? null,
  };
  recordResponseBytes("visualizer.progress", jsonByteLength(body));
  return NextResponse.json(body, { headers: auth.headers });
}
