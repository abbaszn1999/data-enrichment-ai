import { NextRequest, NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { loadActiveJobForSession } from "@/lib/jobs/repo";
import { jsonByteLength, recordResponseBytes } from "@/lib/observability/metrics";
import type { GallerySession } from "@/lib/gallery/types";

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * Slim generation-progress payload. Reads job_runs + gallery_sessions only —
 * never the worksheet blob and never signed image URLs (Issue 5.1 / P0-8).
 */
export async function GET(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from("gallery_sessions")
    .select(
      "id, status, total_rows, ready_rows, failed_rows, cancel_requested, worksheet_revision"
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
    GallerySession,
    | "id"
    | "status"
    | "total_rows"
    | "ready_rows"
    | "failed_rows"
    | "cancel_requested"
    | "worksheet_revision"
  >;

  const job = await loadActiveJobForSession(auth.admin, {
    kind: "gallery",
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
    completed: running ? job.completed_count : session.ready_rows,
    failed: running ? job.failed_count : session.failed_rows,
    jobId: job?.id ?? null,
    jobStatus: job?.status ?? null,
  };
  recordResponseBytes("gallery.progress", jsonByteLength(body));
  return NextResponse.json(body, { headers: auth.headers });
}
