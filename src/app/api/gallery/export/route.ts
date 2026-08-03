import { NextRequest, NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { isContextSubscriptionActive } from "@/lib/workspace-context";
import { buildGalleryExportBuffer } from "@/lib/gallery/export-builder";
import { loadGalleryWorksheetMatchingRevisionAdmin } from "@/lib/gallery/storage-admin";
import { getGalleryExportPath } from "@/lib/gallery/storage-paths";
import { galleryWarn } from "@/lib/gallery/log";
import { parseGalleryProjectSettings } from "@/lib/gallery/settings-schema";
import {
  applyGalleryProjectSettings,
  getGalleryProjectSettingsFromWorksheet,
} from "@/lib/gallery/types";

export const maxDuration = 120;

/** POST /api/gallery/export — { workspaceId, sessionId } */
export async function POST(request: NextRequest) {
  let body: { workspaceId?: string; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, sessionId } = body;
  if (!workspaceId || !sessionId) {
    return NextResponse.json(
      { error: "workspaceId and sessionId are required" },
      { status: 400 }
    );
  }

  const auth = await requireGalleryAuth({
    workspaceId,
  });
  if (!auth.ok) return auth.response;

  if (!auth.ctx.subscription || !isContextSubscriptionActive(auth.ctx)) {
    return NextResponse.json(
      { error: "An active subscription is required" },
      { status: 402, headers: auth.headers }
    );
  }

  const { data: session } = await auth.admin
    .from("gallery_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (!session || session.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: auth.headers });
  }

  let worksheet = await loadGalleryWorksheetMatchingRevisionAdmin(
    workspaceId,
    sessionId,
    Number(session.worksheet_revision ?? 0)
  );
  if (!worksheet) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      {
        status: 409,
        headers: { ...auth.headers, "Retry-After": "2" },
      }
    );
  }
  let settings;
  try {
    settings = parseGalleryProjectSettings(session.settings);
  } catch {
    settings = getGalleryProjectSettingsFromWorksheet(worksheet);
  }
  worksheet = applyGalleryProjectSettings(worksheet, settings);

  const buffer = await buildGalleryExportBuffer(worksheet, async (path) => {
    if (/^https?:\/\//i.test(path)) return path;
    const url = new URL("/api/gallery/images", request.nextUrl.origin);
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("path", path);
    return url.toString();
  });

  const exportPath = getGalleryExportPath(workspaceId, sessionId, "xlsx");
  const { error: uploadError } = await auth.admin.storage
    .from("workspace-files")
    .upload(exportPath, buffer, {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });

  let exportUrl = "";
  if (uploadError) {
    galleryWarn("export", "Export download succeeded but persistence failed", {
      error: uploadError.message,
    });
  } else {
    const { data: signed, error: signError } = await auth.admin.storage
      .from("workspace-files")
      .createSignedUrl(exportPath, 60 * 60);
    if (signError) {
      galleryWarn("export", "Could not sign persisted export", {
        error: signError.message,
      });
    } else {
      exportUrl = signed?.signedUrl || "";
    }
  }

  const fileName = `${(session.name || "gallery").replace(/[^\w.-]+/g, "_")}_export.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      ...auth.headers,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      ...(uploadError ? {} : { "X-Export-Path": exportPath }),
      ...(exportUrl ? { "X-Export-Url": exportUrl } : {}),
    },
  });
}
