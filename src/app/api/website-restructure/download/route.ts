import { NextRequest, NextResponse } from "next/server";
import { requireWrAuth } from "@/lib/website-restructure/auth";
import { jsonError, projectIdSchema, workspaceIdSchema } from "@/lib/website-restructure/api-schema";
import { getWrProjectRow } from "@/lib/website-restructure/server-persist";
import { loadWrBriefAdmin, loadWrVersionAdmin, WR_STORAGE_BUCKET } from "@/lib/website-restructure/storage";
import { buildStandaloneHtmlDocument, logoUrlToDataUri } from "@/lib/website-restructure/export";

/** The tool's actual deliverable: one self-contained HTML file, logo embedded
 *  as base64 so it survives long after any signed URL would expire. */
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
    const project = await getWrProjectRow(auth.admin, wsParsed.data, pidParsed.data);
    if (!project) return jsonError("Project not found", 404);

    const versionNumber = versionParam ? Number(versionParam) : project.activeVersion;
    if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
      return jsonError("This project has no build yet", 409);
    }

    const [version, brief] = await Promise.all([
      loadWrVersionAdmin(auth.admin, wsParsed.data, pidParsed.data, versionNumber),
      loadWrBriefAdmin(auth.admin, wsParsed.data, pidParsed.data),
    ]);
    if (!version) return jsonError("Version not found", 404);

    let logoDataUri: string | null = null;
    if (project.state.logo) {
      const { data: signed } = await auth.admin.storage
        .from(WR_STORAGE_BUCKET)
        .createSignedUrl(project.state.logo.storagePath, 60);
      if (signed?.signedUrl) logoDataUri = await logoUrlToDataUri(signed.signedUrl);
    }

    const html = buildStandaloneHtmlDocument({
      result: version.result,
      logoSrc: logoDataUri,
      title: `${project.name} — Header`,
      dir: brief?.textDirection,
    });

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="header-v${version.version}.html"`,
        ...auth.headers,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build download" },
      { status: 500, headers: auth.headers }
    );
  }
}
