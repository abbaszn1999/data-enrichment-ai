import { NextRequest, NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { parseGalleryProjectSettings } from "@/lib/gallery/settings-schema";
import {
  loadGalleryWorksheetAdmin,
  loadGalleryWorksheetMatchingRevisionAdmin,
  saveGalleryWorksheetAdmin,
} from "@/lib/gallery/storage-admin";
import { galleryRowStoreEnabled } from "@/lib/catalog/flag";
import type { createAdminClient } from "@/lib/supabase-admin";
import { withGalleryWorksheetLock } from "@/lib/gallery/worksheet-lock";
import {
  galleryReferencePathsBelongToSession,
  worksheetImageRefsBelongToSession,
} from "@/lib/gallery/worksheet-security";
import {
  applyGalleryProjectSettings,
  type GalleryProjectSettings,
  type GallerySession,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * Column names of a session without downloading the worksheet: every row
 * carries all columns, so one row of the row store is enough. Falls back to
 * the stored worksheet only when the row store is off or empty.
 */
async function loadSessionColumns(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  sessionId: string
): Promise<string[] | null> {
  if (galleryRowStoreEnabled()) {
    const { data } = await admin
      .from("gallery_session_rows")
      .select("data")
      .eq("session_id", sessionId)
      .order("row_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    const original = (data?.data as { originalData?: Record<string, unknown> } | null)?.originalData;
    if (original && typeof original === "object") return Object.keys(original);
  }
  const worksheet = await loadGalleryWorksheetAdmin(workspaceId, sessionId);
  return worksheet ? worksheet.columns : null;
}

/** PUT — atomically claim and explicitly replace project settings + worksheet. */
export async function PUT(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
    expectedRevision?: number;
    expectedWorksheetRevision?: number;
    settings?: unknown;
    worksheet?: GalleryWorksheetJson;
  } | null;
  const workspaceId = String(body?.workspaceId || "");
  const expectedRevision = Number(body?.expectedRevision);
  const expectedWorksheetRevision = Number(body?.expectedWorksheetRevision);
  const settingsOnly = !body?.worksheet;
  if (
    !workspaceId ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    (!settingsOnly &&
      (!Number.isInteger(expectedWorksheetRevision) || expectedWorksheetRevision < 0))
  ) {
    return NextResponse.json(
      { error: "workspaceId and valid revisions are required" },
      { status: 400 }
    );
  }

  const auth = await requireGalleryAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  let settings: GalleryProjectSettings;
  try {
    settings = parseGalleryProjectSettings(body?.settings);
  } catch {
    return NextResponse.json(
      { error: "Invalid gallery settings" },
      { status: 400, headers: auth.headers }
    );
  }
  if (
    !galleryReferencePathsBelongToSession(
      settings,
      workspaceId,
      sessionId
    )
  ) {
    return NextResponse.json(
      { error: "One or more reference image paths are invalid" },
      { status: 400, headers: auth.headers }
    );
  }
  if (settingsOnly) {
    // Autosave path: only the project settings change (gallery_sessions.settings).
    // The worksheet is never re-uploaded, so it is safe while a run is active
    // (the run uses the settings frozen when it started).
    const columns = await loadSessionColumns(auth.admin, workspaceId, sessionId);
    if (!columns) {
      return NextResponse.json(
        { error: "Worksheet not found" },
        { status: 404, headers: auth.headers }
      );
    }
    if (
      (settings.originalImageColumn !== null &&
        !columns.includes(settings.originalImageColumn)) ||
      settings.selectedColumns.some((column) => !columns.includes(column)) ||
      new Set(settings.selectedColumns).size !== settings.selectedColumns.length
    ) {
      return NextResponse.json(
        { error: "One or more selected worksheet columns are invalid" },
        { status: 400, headers: auth.headers }
      );
    }
    const { data: current, error: currentError } = await auth.admin
      .from("gallery_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId)
      .single();
    if (currentError || !current) {
      return NextResponse.json(
        { error: "Gallery session not found" },
        { status: 404, headers: auth.headers }
      );
    }
    const { data: nextRevision, error: saveError } = await auth.admin.rpc(
      "save_gallery_session_settings",
      {
        p_session_id: sessionId,
        p_workspace_id: workspaceId,
        p_expected_revision: expectedRevision,
        p_settings: settings,
      }
    );
    if (saveError) {
      return NextResponse.json(
        { error: saveError.message },
        { status: 500, headers: auth.headers }
      );
    }
    if (nextRevision === null || nextRevision === undefined) {
      return NextResponse.json(
        { error: "Project changed in another tab. Reload and try again." },
        { status: 409, headers: auth.headers }
      );
    }
    return NextResponse.json(
      {
        session: {
          ...(current as GallerySession),
          settings,
          settings_revision: Number(nextRevision),
        },
        settings,
      },
      { headers: auth.headers }
    );
  }

  const suppliedWorksheet = body?.worksheet;
  if (
    !suppliedWorksheet ||
    suppliedWorksheet.sessionId !== sessionId ||
    !Array.isArray(suppliedWorksheet.rows) ||
    !Array.isArray(suppliedWorksheet.columns)
  ) {
    return NextResponse.json(
      { error: "A valid complete worksheet is required" },
      { status: 400, headers: auth.headers }
    );
  }
  if (
    !worksheetImageRefsBelongToSession(
      suppliedWorksheet,
      workspaceId,
      sessionId
    )
  ) {
    return NextResponse.json(
      { error: "Worksheet contains an invalid private image path" },
      { status: 400, headers: auth.headers }
    );
  }
  if (
    (settings.originalImageColumn !== null &&
      !suppliedWorksheet.columns.includes(settings.originalImageColumn)) ||
    settings.selectedColumns.some(
      (column) => !suppliedWorksheet.columns.includes(column)
    ) ||
    new Set(settings.selectedColumns).size !== settings.selectedColumns.length
  ) {
    return NextResponse.json(
      { error: "One or more selected worksheet columns are invalid" },
      { status: 400, headers: auth.headers }
    );
  }

  try {
    const result = await withGalleryWorksheetLock(
      workspaceId,
      sessionId,
      async () => {
        const { data: current, error: currentError } = await auth.admin
          .from("gallery_sessions")
          .select("*")
          .eq("id", sessionId)
          .eq("workspace_id", workspaceId)
          .single();
        if (currentError || !current) {
          throw new Error(currentError?.message || "Gallery session not found");
        }
        if (
          current.status === "processing" ||
          suppliedWorksheet.activeRun?.status === "running" ||
          suppliedWorksheet.activeRun?.status === "queued"
        ) {
          throw new Error("Worksheet cannot be saved during generation");
        }
        if (suppliedWorksheet.rows.length !== Number(current.total_rows)) {
          throw new Error("The complete worksheet row count does not match");
        }
        const persisted = await loadGalleryWorksheetMatchingRevisionAdmin(
          workspaceId,
          sessionId,
          expectedWorksheetRevision
        );
        const persistedIds = new Set(
          persisted?.rows.map((row) => row.id) ?? []
        );
        if (
          !persisted ||
          suppliedWorksheet.rows.some((row) => !persistedIds.has(row.id))
        ) {
          throw new Error("The complete worksheet rows do not match");
        }

        const worksheet = applyGalleryProjectSettings(
          suppliedWorksheet,
          settings
        );
        const { data: revisions, error: claimError } = await auth.admin.rpc(
          "claim_gallery_manual_save",
          {
            p_session_id: sessionId,
            p_workspace_id: workspaceId,
            p_expected_settings_revision: expectedRevision,
            p_expected_worksheet_revision: expectedWorksheetRevision,
            p_settings: settings,
          }
        );
        if (claimError) throw claimError;
        if (!revisions || typeof revisions !== "object") {
          throw new Error("Project changed in another tab. Reload and try again.");
        }
        const settingsRevision = Number(
          (revisions as Record<string, unknown>).settingsRevision
        );
        const worksheetRevision = Number(
          (revisions as Record<string, unknown>).worksheetRevision
        );
        worksheet.revision = worksheetRevision;
        try {
          await saveGalleryWorksheetAdmin(
            workspaceId,
            sessionId,
            worksheet,
            worksheetRevision
          );
        } catch (error) {
          // Compensate the DB claim so a failed Storage write cannot leave GET
          // waiting forever for a revision that was never persisted.
          await auth.admin
            .from("gallery_sessions")
            .update({
              settings: current.settings,
              settings_revision: expectedRevision,
              worksheet_revision: expectedWorksheetRevision,
            })
            .eq("id", sessionId)
            .eq("workspace_id", workspaceId)
            .eq("settings_revision", settingsRevision)
            .eq("worksheet_revision", worksheetRevision);
          throw error;
        }

        return {
          worksheet,
          session: {
            ...(current as GallerySession),
            settings,
            settings_revision: settingsRevision,
            worksheet_revision: worksheetRevision,
          },
        };
      }
    );

    return NextResponse.json(
      { ...result, settings },
      { headers: auth.headers }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    const status = /another tab|during generation|row count/i.test(message)
      ? 409
      : 500;
    return NextResponse.json(
      { error: message },
      { status, headers: auth.headers }
    );
  }
}
