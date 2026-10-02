import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import { getVisualizerPrefix } from "@/lib/visualizer/storage-paths";
import { createVisualizerSignedUrlsAdmin } from "@/lib/visualizer/storage-admin";

type Ctx = { params: Promise<{ sessionId: string }> };

const MAX_PATHS = 200;

function pathBelongsToSession(path: string, workspaceId: string, sessionId: string): boolean {
  const prefix = `${getVisualizerPrefix(workspaceId, sessionId)}/`;
  return path.startsWith(prefix) && !path.includes("..") && !path.includes("\\");
}

/**
 * POST /api/visualizer/sessions/[sessionId]/signed-urls
 * Body: { workspaceId, paths }
 *
 * Signs stored image paths the preview is still missing. Used while a run is
 * in progress, because the delta poll moves on even when signing failed.
 */
export async function POST(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
    paths?: unknown;
  } | null;
  const workspaceId = body?.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const auth = await requireVisualizerAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const { data: owned } = await auth.admin
    .from("visualizer_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: auth.headers });
  }

  const requested = Array.isArray(body?.paths)
    ? body.paths.filter((path): path is string => typeof path === "string" && path.length > 0)
    : [];
  if (requested.length > MAX_PATHS) {
    return NextResponse.json(
      { error: `At most ${MAX_PATHS} paths per request` },
      { status: 400, headers: auth.headers }
    );
  }
  const paths = [...new Set(requested.filter((path) => pathBelongsToSession(path, workspaceId, sessionId)))];
  const signedUrls = paths.length > 0 ? await createVisualizerSignedUrlsAdmin(paths, 3600) : {};
  return NextResponse.json({ signedUrls }, { headers: auth.headers });
}
