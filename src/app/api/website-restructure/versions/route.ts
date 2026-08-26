import { NextRequest, NextResponse } from "next/server";
import { requireWrAuth } from "@/lib/website-restructure/auth";
import { jsonError, projectIdSchema, restoreVersionBodySchema, workspaceIdSchema } from "@/lib/website-restructure/api-schema";
import { getWrProjectRow } from "@/lib/website-restructure/server-persist";
import { listWrVersionsAdmin, loadWrVersionAdmin, WR_STORAGE_BUCKET } from "@/lib/website-restructure/storage";

/** GET ?workspaceId&projectId → version list metadata.
 *  GET ?...&version=N → that version's full html/css/js for the preview. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const projectId = request.nextUrl.searchParams.get("projectId");
  const versionParam = request.nextUrl.searchParams.get("version");
  const wsParsed = workspaceIdSchema.safeParse(workspaceId);
  const pidParsed = projectIdSchema.safeParse(projectId);
  if (!wsParsed.success || !pidParsed.success) {
    return jsonError("workspaceId and projectId are required", 400);
  }

  const auth = await requireWrAuth({ workspaceId: wsParsed.data });
  if (!auth.ok) return auth.response;

  try {
    if (versionParam) {
      const versionNumber = Number(versionParam);
      if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
        return jsonError("Invalid version", 400);
      }
      const version = await loadWrVersionAdmin(auth.admin, wsParsed.data, pidParsed.data, versionNumber);
      if (!version) return jsonError("Version not found", 404);

      const project = await getWrProjectRow(auth.admin, wsParsed.data, pidParsed.data);
      let logoUrl: string | null = null;
      if (project?.state.logo) {
        const { data: signed } = await auth.admin.storage
          .from(WR_STORAGE_BUCKET)
          .createSignedUrl(project.state.logo.storagePath, 3600);
        logoUrl = signed?.signedUrl ?? null;
      }
      return NextResponse.json({ version, logoUrl }, { headers: auth.headers });
    }

    const versions = await listWrVersionsAdmin(auth.admin, wsParsed.data, pidParsed.data);
    return NextResponse.json({ versions }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load versions" },
      { status: 500, headers: auth.headers }
    );
  }
}

/** Rollback: switches `active_version` without consuming an edit message.
 *  Refused mid-build so it can't race a generation writing the same pointer. */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = restoreVersionBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid restore payload", 400);
  const { workspaceId, projectId, version } = parsed.data;

  const auth = await requireWrAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  try {
    const project = await getWrProjectRow(auth.admin, workspaceId, projectId);
    if (!project) return jsonError("Project not found", 404);
    if (project.phase === "building") {
      return jsonError("Cannot restore a version while a build is running", 409);
    }
    const target = await loadWrVersionAdmin(auth.admin, workspaceId, projectId, version);
    if (!target) return jsonError("Version not found", 404);

    const { error } = await auth.admin
      .from("wr_projects")
      .update({ active_version: version })
      .eq("workspace_id", workspaceId)
      .eq("id", projectId);
    if (error) throw error;

    return NextResponse.json({ ok: true, activeVersion: version }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to restore version" },
      { status: 500, headers: auth.headers }
    );
  }
}
