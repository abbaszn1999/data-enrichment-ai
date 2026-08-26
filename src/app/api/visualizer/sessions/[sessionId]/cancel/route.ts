import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import { loadActiveJobForSession, requestJobCancel } from "@/lib/jobs/repo";

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * Request cooperative cancellation (gallery-style).
 * In-flight product/API requests are allowed to finish; the generation loop
 * observes this flag before claiming more work.
 */
export async function POST(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
  } | null;
  const workspaceId = String(body?.workspaceId || "");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }

  const auth = await requireVisualizerAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from("visualizer_sessions")
    .update({ cancel_requested: true })
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: auth.headers }
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "Generation is no longer running" },
      { status: 409, headers: auth.headers }
    );
  }

  const active = await loadActiveJobForSession(auth.admin, {
    kind: "visualizer",
    sessionId,
    workspaceId,
  });
  if (active) {
    await requestJobCancel(auth.admin, active.id, workspaceId).catch(() => undefined);
  }

  return NextResponse.json(
    { accepted: true },
    { status: 202, headers: auth.headers }
  );
}
