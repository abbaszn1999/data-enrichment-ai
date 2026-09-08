import { NextRequest, NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { isContextSubscriptionActive } from "@/lib/workspace-context";
import {
  getGalleryPrefix,
  getGallerySourcePath,
  getGalleryWorksheetPath,
} from "@/lib/gallery/storage-paths";
import { saveGalleryWorksheetAdmin } from "@/lib/gallery/storage-admin";
import { parseWorksheetFile } from "@/lib/gallery/worksheet-parser";
import {
  getGalleryProjectSettingsFromWorksheet,
  type GallerySession,
} from "@/lib/gallery/types";
import {
  PlanLimitError,
  assertJobRowQuota,
  planLimitResponse,
  upgradeUrlFor,
} from "@/lib/plan-limits";
import {
  UploadLimitError,
  assertRowCount,
  assertSpreadsheetFile,
} from "@/lib/upload-limits";

export const maxDuration = 60;

/** GET /api/gallery/sessions?workspaceId= */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from("gallery_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: auth.headers });
  }

  return NextResponse.json({ sessions: (data ?? []) as GallerySession[] }, { headers: auth.headers });
}

/** POST /api/gallery/sessions — multipart: workspaceId, name, file */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const workspaceId = String(form.get("workspaceId") || "");
  const name = String(form.get("name") || "").trim();
  const file = form.get("file");

  if (!workspaceId || !name) {
    return NextResponse.json({ error: "workspaceId and name are required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  try {
    assertSpreadsheetFile({ name: file.name, size: file.size }, "gallery");
  } catch (error) {
    const message =
      error instanceof UploadLimitError ? error.message : "Invalid file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json(
      { error: "Session name must be 120 characters or fewer" },
      { status: 400 }
    );
  }

  const auth = await requireGalleryAuth({
    workspaceId,
    requireWrite: true,
  });
  if (!auth.ok) return auth.response;

  if (!auth.ctx.subscription || !isContextSubscriptionActive(auth.ctx)) {
    return NextResponse.json(
      { error: "An active subscription is required" },
      { status: 402, headers: auth.headers }
    );
  }

  const sessionId = crypto.randomUUID();
  const buffer = await file.arrayBuffer();

  let worksheet;
  try {
    worksheet = await parseWorksheetFile(buffer, sessionId);
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to parse worksheet",
      },
      { status: 400, headers: auth.headers }
    );
  }

  if (worksheet.rows.length === 0) {
    return NextResponse.json(
      { error: "Worksheet has no data rows" },
      { status: 400, headers: auth.headers }
    );
  }

  try {
    assertRowCount(worksheet.rows.length, "gallery");
    await assertJobRowQuota({
      workspaceId,
      rowCount: worksheet.rows.length,
    });
  } catch (error) {
    if (error instanceof UploadLimitError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400, headers: auth.headers }
      );
    }
    if (error instanceof PlanLimitError) {
      const limited = planLimitResponse(
        error,
        await upgradeUrlFor(auth.admin, workspaceId)
      );
      for (const [key, value] of Object.entries(auth.headers)) {
        limited.headers.set(key, value);
      }
      return limited;
    }
    throw error;
  }

  const sourcePath = getGallerySourcePath(workspaceId, sessionId, file.name);
  const storagePath = getGalleryWorksheetPath(workspaceId, sessionId);
  const imagesPrefix = getGalleryPrefix(workspaceId, sessionId);

  const { error: uploadSourceErr } = await auth.admin.storage
    .from("workspace-files")
    .upload(sourcePath, Buffer.from(buffer), {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadSourceErr) {
    return NextResponse.json(
      { error: `Failed to store source file: ${uploadSourceErr.message}` },
      { status: 500, headers: auth.headers }
    );
  }

  // Insert session in database first so child table foreign keys (gallery_session_rows) succeed.
  const { data: session, error: insertErr } = await auth.admin
    .from("gallery_sessions")
    .insert({
      id: sessionId,
      workspace_id: workspaceId,
      name,
      created_by: auth.user.id,
      status: "ready",
      source_file_name: file.name,
      storage_path: storagePath,
      images_prefix: imagesPrefix,
      total_rows: worksheet.rows.length,
      ready_rows: 0,
      failed_rows: 0,
      settings: getGalleryProjectSettingsFromWorksheet(worksheet),
      settings_revision: 0,
    })
    .select()
    .single();

  if (insertErr) {
    await auth.admin.storage
      .from("workspace-files")
      .remove([sourcePath]);
    return NextResponse.json(
      { error: insertErr.message },
      { status: 500, headers: auth.headers }
    );
  }

  try {
    await saveGalleryWorksheetAdmin(workspaceId, sessionId, worksheet, 0);
  } catch (error) {
    await auth.admin.from("gallery_sessions").delete().eq("id", sessionId);
    await auth.admin.storage
      .from("workspace-files")
      .remove([sourcePath, storagePath]);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save gallery worksheet",
      },
      { status: 500, headers: auth.headers }
    );
  }

  return NextResponse.json(
    { session: session as GallerySession, worksheet },
    { status: 201, headers: auth.headers }
  );
}
