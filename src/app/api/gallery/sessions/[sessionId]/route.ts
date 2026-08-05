import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireGalleryAuth, requireGalleryAdmin } from "@/lib/gallery/auth";
import {
  loadGalleryWorksheetConsistentAdmin,
  loadGalleryWorksheetMatchingRevisionAdmin,
  saveGalleryWorksheetAdmin,
  removeGalleryPathsAdmin,
  removeGalleryPrefixAdmin,
} from "@/lib/gallery/storage-admin";
import { signGalleryWorksheetImages } from "@/lib/gallery/signed-urls";
import { reconcileGalleryAiAssetPaths } from "@/lib/gallery/ai-assets";
import {
  applyGalleryProjectSettings,
  getGalleryProjectSettingsFromWorksheet,
  type GalleryProjectSettings,
  type GallerySession,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";
import { galleryWarn } from "@/lib/gallery/log";
import { withGalleryWorksheetLock } from "@/lib/gallery/worksheet-lock";
import { imageRefsMatch } from "@/lib/gallery/image-refs";
import { getGalleryPrefix } from "@/lib/gallery/storage-paths";
import {
  parseAiSettings,
  parseGalleryProjectSettings,
  parseScrapingSettings,
} from "@/lib/gallery/settings-schema";

type Ctx = { params: Promise<{ sessionId: string }> };

async function loadOwnedSession(
  admin: ReturnType<typeof createAdminClient>,
  sessionId: string,
  workspaceId: string
) {
  const { data, error } = await admin
    .from("gallery_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error || !data) return null;
  if (data.workspace_id !== workspaceId) return null;
  return data as GallerySession;
}

function resolveSessionSettings(
  session: GallerySession,
  worksheet: GalleryWorksheetJson
): GalleryProjectSettings {
  try {
    return parseGalleryProjectSettings(session.settings);
  } catch {
    return getGalleryProjectSettingsFromWorksheet(worksheet);
  }
}

function pruneImageProvenance(row: GalleryWorksheetJson["rows"][number], path: string) {
  const images = row.sourceMeta?.images;
  if (!Array.isArray(images)) return;
  row.sourceMeta = {
    ...row.sourceMeta,
    images: images.filter(
      (image) => !imageRefsMatch(image.ref || image.url || "", path)
    ),
  };
}

/** GET /api/gallery/sessions/[sessionId]?workspaceId= */
export async function GET(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const session = await loadOwnedSession(auth.admin, sessionId, workspaceId);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: auth.headers });
  }

  const worksheet = await loadGalleryWorksheetMatchingRevisionAdmin(
    workspaceId,
    sessionId,
    Number(session.worksheet_revision ?? 0)
  );
  if (!worksheet || worksheet.rows.length !== session.total_rows) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      {
        status: 409,
        headers: { ...auth.headers, "Retry-After": "2" },
      }
    );
  }
  let projectSettings = resolveSessionSettings(session, worksheet);
  let hydratedWorksheet = applyGalleryProjectSettings(worksheet, projectSettings);
  const settingsWereMissing =
    !session.settings ||
    typeof session.settings !== "object" ||
    Object.keys(session.settings).length === 0;
  const beforePaths = JSON.stringify({
    logoPath: hydratedWorksheet.settings.ai.logoPath,
    brandGuidePath: hydratedWorksheet.settings.ai.brandGuidePath,
    sceneReferencePath: hydratedWorksheet.settings.ai.sceneReferencePath,
  });
  // Storage discovery is migration-only. Once DB settings exist, null is an
  // intentional deletion and must not be resurrected from an orphaned file.
  if (settingsWereMissing) {
    await reconcileGalleryAiAssetPaths(workspaceId, sessionId, hydratedWorksheet);
  }
  const afterPaths = JSON.stringify({
    logoPath: hydratedWorksheet.settings.ai.logoPath,
    brandGuidePath: hydratedWorksheet.settings.ai.brandGuidePath,
    sceneReferencePath: hydratedWorksheet.settings.ai.sceneReferencePath,
  });
  if (beforePaths !== afterPaths || settingsWereMissing) {
    projectSettings = getGalleryProjectSettingsFromWorksheet(hydratedWorksheet);
    const expectedRevision = Number(session.settings_revision ?? 0);
    const { data: nextRevision, error: migrationError } = await auth.admin.rpc(
      "save_gallery_session_settings",
      {
        p_session_id: sessionId,
        p_workspace_id: workspaceId,
        p_expected_revision: expectedRevision,
        p_settings: projectSettings,
      }
    );
    if (migrationError) {
      return NextResponse.json(
        { error: migrationError.message },
        { status: 500, headers: auth.headers }
      );
    }
    if (nextRevision === null || nextRevision === undefined) {
      const refreshed = await loadOwnedSession(
        auth.admin,
        sessionId,
        workspaceId
      );
      if (!refreshed) {
        return NextResponse.json(
          { error: "Settings changed while loading; retry" },
          { status: 409, headers: auth.headers }
        );
      }
      session.settings = refreshed.settings;
      session.settings_revision = refreshed.settings_revision;
      projectSettings = resolveSessionSettings(refreshed, hydratedWorksheet);
    } else {
      session.settings = projectSettings;
      session.settings_revision = Number(nextRevision);
    }
  }
  hydratedWorksheet = applyGalleryProjectSettings(
    hydratedWorksheet,
    projectSettings
  );
  const runStartedAt = hydratedWorksheet.activeRun?.startedAt;
  const runIsActive =
    hydratedWorksheet.activeRun?.status === "running" ||
    hydratedWorksheet.activeRun?.status === "queued";
  if (
    hydratedWorksheet.activeRun &&
    runIsActive &&
    session.status !== "processing"
  ) {
    hydratedWorksheet.activeRun.status = "failed";
    hydratedWorksheet.activeRun.finishedAt = new Date().toISOString();
    for (const row of hydratedWorksheet.rows) {
      if (row.status === "queued" || row.status === "generating") {
        row.status = "not_started";
        row.generationStage = undefined;
        row.errorMessage = undefined;
      }
    }
    await saveGalleryWorksheetAdmin(workspaceId, sessionId, hydratedWorksheet);
  } else if (
    hydratedWorksheet.activeRun &&
    runIsActive &&
    (!runStartedAt ||
      Date.now() - new Date(runStartedAt).getTime() > 10 * 60 * 1000)
  ) {
    hydratedWorksheet.activeRun.status = "failed";
    hydratedWorksheet.activeRun.finishedAt = new Date().toISOString();
    for (const row of hydratedWorksheet.rows) {
      if (row.status === "queued" || row.status === "generating") {
        row.status = "failed";
        row.generationStage = undefined;
        row.errorMessage = "Generation timed out; retry this row";
      }
    }
    await saveGalleryWorksheetAdmin(workspaceId, sessionId, hydratedWorksheet);
    await auth.admin
      .from("gallery_sessions")
      .update({
        status: "failed",
        error_message: "Generation timed out and can be retried",
      })
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId);
    session.status = "failed";
    session.error_message = "Generation timed out and can be retried";
  }
  const includeSignedUrls =
    request.nextUrl.searchParams.get("includeSignedUrls") !== "0";
  const signedUrls =
    hydratedWorksheet && includeSignedUrls
      ? await signGalleryWorksheetImages(hydratedWorksheet)
      : {};
  return NextResponse.json(
    { session, worksheet: hydratedWorksheet, signedUrls },
    { headers: auth.headers }
  );
}

/** PATCH /api/gallery/sessions/[sessionId] — update name / worksheet settings / rows */
export async function PATCH(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  let body: {
    workspaceId?: string;
    revision?: number;
    name?: string;
    worksheet?: Partial<GalleryWorksheetJson>;
    deleteGalleryImage?: { rowId?: string; path?: string };
    deleteRows?: { rowIds?: string[] };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceId = body.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  const legacySettingsKeys = [
    "settings",
    "originalImageColumn",
    "originalImageSelectionExplicit",
    "selectedColumns",
  ] as const;
  if (
    body.worksheet &&
    legacySettingsKeys.some((key) =>
      Object.prototype.hasOwnProperty.call(body.worksheet, key)
    )
  ) {
    return NextResponse.json(
      { error: "Project settings must be saved through the manual Save endpoint" },
      { status: 400, headers: auth.headers }
    );
  }

  const session = await loadOwnedSession(auth.admin, sessionId, workspaceId);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: auth.headers });
  }

  if (body.name?.trim()) {
    await auth.admin
      .from("gallery_sessions")
      .update({ name: body.name.trim() })
      .eq("id", sessionId);
  }

  const worksheet = await loadGalleryWorksheetConsistentAdmin(
    workspaceId,
    sessionId,
    session.total_rows
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

  const mutatesWorksheet =
    !!body.worksheet || !!body.deleteGalleryImage || !!body.deleteRows;
  if (
    mutatesWorksheet &&
    body.revision !== undefined &&
    (!Number.isInteger(body.revision) || body.revision < 0)
  ) {
    return NextResponse.json(
      { error: "Invalid worksheet revision" },
      { status: 400, headers: auth.headers }
    );
  }

  const generationIsActive =
    session.status === "processing" ||
    worksheet.activeRun?.status === "running" ||
    worksheet.activeRun?.status === "queued";

  // Fine-grained lock: image deletes are safe during generation (merged via
  // revision + generation reconcile). Structural edits stay blocked.
  if (generationIsActive) {
    if (body.worksheet || body.deleteRows) {
      return NextResponse.json(
        { error: "Worksheet cannot be edited while generation is active" },
        { status: 409, headers: auth.headers }
      );
    }
    // deleteGalleryImage is allowed through.
  }

  const deletedStoragePaths: string[] = [];
  let deletedRows = false;
  let workingSheet = worksheet;

  // Validate patches against the loaded worksheet first (cheap fail-fast).
  if (body.worksheet?.originalImageColumn !== undefined) {
    const next = body.worksheet.originalImageColumn;
    if (next !== null && !worksheet.columns.includes(next)) {
      return NextResponse.json(
        { error: "Invalid original image column" },
        { status: 400, headers: auth.headers }
      );
    }
  }
  if (body.worksheet?.selectedColumns) {
    const selected = [
      ...new Set(
        body.worksheet.selectedColumns.filter((column) =>
          worksheet.columns.includes(column)
        )
      ),
    ];
    if (selected.length !== body.worksheet.selectedColumns.length) {
      return NextResponse.json(
        { error: "One or more worksheet columns are invalid" },
        { status: 400, headers: auth.headers }
      );
    }
  }
  if (body.worksheet?.settings) {
    const legacyScraping = (
      body.worksheet.settings as {
        google?: Partial<typeof worksheet.settings.scraping>;
      }
    ).google;
    try {
      parseScrapingSettings({
        ...worksheet.settings.scraping,
        ...(legacyScraping || {}),
        ...(body.worksheet.settings.scraping || {}),
        main: {
          ...worksheet.settings.scraping.main,
          ...(legacyScraping?.main || {}),
          ...(body.worksheet.settings.scraping?.main || {}),
        },
      });
      parseAiSettings({
        ...worksheet.settings.ai,
        ...(body.worksheet.settings.ai || {}),
        main: {
          ...worksheet.settings.ai.main,
          ...(body.worksheet.settings.ai?.main || {}),
        },
        logoPath: worksheet.settings.ai.logoPath,
        brandGuidePath: worksheet.settings.ai.brandGuidePath,
        sceneReferencePath: worksheet.settings.ai.sceneReferencePath,
      });
    } catch {
      return NextResponse.json(
        { error: "Invalid gallery settings" },
        { status: 400, headers: auth.headers }
      );
    }
  }
  if (body.worksheet?.rows && body.worksheet.rows.length > 100) {
    return NextResponse.json(
      { error: "Too many row updates in one request" },
      { status: 400, headers: auth.headers }
    );
  }
  if (body.deleteRows) {
    const rowIds = [
      ...new Set(
        (body.deleteRows.rowIds ?? []).map((value) => String(value)).filter(Boolean)
      ),
    ];
    if (rowIds.length === 0 || rowIds.length > 10_000) {
      return NextResponse.json(
        { error: "Select between 1 and 10,000 rows to delete" },
        { status: 400, headers: auth.headers }
      );
    }
  }

  if (mutatesWorksheet) {
    try {
      workingSheet = await withGalleryWorksheetLock(
        workspaceId,
        sessionId,
        async () => {
          // Always mutate the freshest worksheet so generation results / deletes
          // are not wiped by a stale Storage read.
          const { data: revRow, error: revReadError } = await auth.admin
            .from("gallery_sessions")
            .select("worksheet_revision, total_rows")
            .eq("id", sessionId)
            .eq("workspace_id", workspaceId)
            .single();
          if (revReadError) throw revReadError;
          const dbRevision = Number(revRow?.worksheet_revision ?? 0);
          const expectedRows = Number(revRow?.total_rows ?? session.total_rows);
          const fresh = await loadGalleryWorksheetMatchingRevisionAdmin(
            workspaceId,
            sessionId,
            dbRevision
          );
          if (!fresh || fresh.rows.length !== expectedRows) {
            throw new Error("Worksheet is synchronizing; retry shortly");
          }
          const runIsActive =
            fresh.activeRun?.status === "running" ||
            fresh.activeRun?.status === "queued";
          if (runIsActive && (body.worksheet || body.deleteRows)) {
            throw new Error("Worksheet cannot be edited while generation is active");
          }
          // deleteGalleryImage remains allowed while a run is active.

          if (body.worksheet) {
            const patch = body.worksheet;
            if (patch.originalImageColumn !== undefined) {
              // Selecting/changing the original-image column must NOT wipe existing
              // generated main images. Copy-from-original happens only during generation.
              fresh.originalImageColumn = patch.originalImageColumn;
              fresh.originalImageSelectionExplicit = true;
            }
            if (patch.selectedColumns) {
              fresh.selectedColumns = [
                ...new Set(
                  patch.selectedColumns.filter((column) =>
                    fresh.columns.includes(column)
                  )
                ),
              ];
            }
            if (patch.settings) {
              // Capture paths before merge — client patches must never overwrite them.
              const retainedLogoPath = fresh.settings.ai.logoPath;
              const retainedBrandGuidePath = fresh.settings.ai.brandGuidePath;
              const retainedSceneReferencePath =
                fresh.settings.ai.sceneReferencePath;
              const {
                logoPath: _logoPath,
                brandGuidePath: _brandGuidePath,
                sceneReferencePath: _sceneReferencePath,
                ...aiPatchWithoutPaths
              } = patch.settings.ai || {};
              void _logoPath;
              void _brandGuidePath;
              void _sceneReferencePath;
              const legacyScraping = (
                patch.settings as {
                  google?: Partial<typeof fresh.settings.scraping>;
                }
              ).google;
              fresh.settings = {
                ...fresh.settings,
                provider:
                  patch.settings.provider === "ai" ? "ai" : "scraping",
                scraping: parseScrapingSettings({
                  ...fresh.settings.scraping,
                  ...(legacyScraping || {}),
                  ...(patch.settings.scraping || {}),
                  // Deep-merge nested Main settings so a partial scraping patch
                  // cannot drop imagesPerRow / instructions.
                  main: {
                    ...fresh.settings.scraping.main,
                    ...(legacyScraping?.main || {}),
                    ...(patch.settings.scraping?.main || {}),
                  },
                }),
                ai: parseAiSettings({
                  ...fresh.settings.ai,
                  ...aiPatchWithoutPaths,
                  main: {
                    ...fresh.settings.ai.main,
                    ...(aiPatchWithoutPaths.main || {}),
                  },
                  logoPath: retainedLogoPath,
                  brandGuidePath: retainedBrandGuidePath,
                  sceneReferencePath: retainedSceneReferencePath,
                }),
              };
              delete (
                fresh.settings as { google?: unknown }
              ).google;
              // Stale worksheet reads after asset upload can miss paths; recover from Storage.
              await reconcileGalleryAiAssetPaths(workspaceId, sessionId, fresh);
            }
            if (patch.rows) {
              const byId = new Map(fresh.rows.map((r) => [r.id, r]));
              for (const rowPatch of patch.rows) {
                const existing = byId.get(rowPatch.id);
                if (!existing) continue;
                if (rowPatch.originalData) {
                  const safeData: Record<string, string> = {};
                  for (const [key, value] of Object.entries(rowPatch.originalData)) {
                    if (!fresh.columns.includes(key)) continue;
                    safeData[key] = String(value ?? "").slice(0, 5000);
                  }
                  existing.originalData = {
                    ...existing.originalData,
                    ...safeData,
                  };
                }
              }
              fresh.rows = Array.from(byId.values()).sort(
                (a, b) => a.rowIndex - b.rowIndex
              );
            }
          }

          if (body.deleteGalleryImage) {
            const rowId = String(body.deleteGalleryImage.rowId || "");
            const path = String(body.deleteGalleryImage.path || "");
            const row = fresh.rows.find((item) => item.id === rowId);
            if (!row || !path) {
              throw new Error("Image is not referenced by this product");
            }
            const mainPaths = Array.isArray(row.mainImagePaths)
              ? [...row.mainImagePaths]
              : row.mainImagePath
                ? [row.mainImagePath]
                : [];
            const galleryPaths = [...(row.galleryImagePaths ?? [])];
            const mainHit = mainPaths.find((item) => imageRefsMatch(item, path));
            const galleryHit = galleryPaths.find((item) =>
              imageRefsMatch(item, path)
            );
            // Already removed by a concurrent delete — treat as success but still
            // persist consistent mainImagePaths so legacy mainImagePath cannot revive.
            if (!mainHit && !galleryHit) {
              row.mainImagePaths = mainPaths;
              row.mainImagePath = mainPaths[0] ?? null;
            } else if (mainHit) {
              row.mainImagePaths = mainPaths.filter(
                (item) => !imageRefsMatch(item, path)
              );
              row.mainImagePath = row.mainImagePaths[0] ?? null;
              deletedStoragePaths.push(mainHit);
            } else if (galleryHit) {
              row.galleryImagePaths = galleryPaths.filter(
                (item) => !imageRefsMatch(item, path)
              );
              deletedStoragePaths.push(galleryHit);
            }
            pruneImageProvenance(row, path);
          }

          if (body.deleteRows) {
            const rowIds = [
              ...new Set(
                (body.deleteRows.rowIds ?? [])
                  .map((value) => String(value))
                  .filter(Boolean)
              ),
            ];
            const requested = new Set(rowIds);
            const matchedRows = fresh.rows.filter((row) => requested.has(row.id));
            if (matchedRows.length !== rowIds.length) {
              throw new Error("One or more selected rows no longer exist");
            }
            for (const row of matchedRows) {
              const mainPaths = row.mainImagePaths?.length
                ? row.mainImagePaths
                : row.mainImagePath
                  ? [row.mainImagePath]
                  : [];
              deletedStoragePaths.push(...mainPaths);
              deletedStoragePaths.push(...row.galleryImagePaths);
            }
            fresh.rows = fresh.rows.filter((row) => !requested.has(row.id));
            deletedRows = true;
          }

          const { data: nextRevision, error: revisionError } =
            await auth.admin.rpc("claim_gallery_worksheet_revision", {
              p_session_id: sessionId,
              p_workspace_id: workspaceId,
              p_expected_revision:
                body.revision ?? dbRevision,
            });
          if (revisionError) throw revisionError;
          if (nextRevision === null || nextRevision === undefined) {
            throw new Error("WORKSHEET_REVISION_CONFLICT");
          }
          const claimed = Number(nextRevision);
          fresh.revision = claimed;
          await saveGalleryWorksheetAdmin(
            workspaceId,
            sessionId,
            fresh,
            claimed
          );
          return fresh;
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update failed";
      const status = /synchronizing|generation is active|no longer exist|REVISION_CONFLICT/i.test(
        message
      )
        ? 409
        : /not referenced/i.test(message)
          ? 404
          : 500;
      return NextResponse.json(
        { error: message },
        {
          status,
          headers: {
            ...auth.headers,
            ...(status === 409 ? { "Retry-After": "2" } : {}),
          },
        }
      );
    }
  }
  const sessionPrefix = `${getGalleryPrefix(workspaceId, sessionId)}/`;
  const storedPaths = deletedStoragePaths.filter(
    (path) => !/^https?:\/\//i.test(path) && path.startsWith(sessionPrefix)
  );
  if (storedPaths.length > 0) {
    try {
      await removeGalleryPathsAdmin([...new Set(storedPaths)]);
    } catch (error) {
      galleryWarn("gallery:storage:delete", "Worksheet updated but file cleanup failed", {
        pathCount: deletedStoragePaths.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deletedRows) {
    const readyRows = workingSheet.rows.filter((row) => row.status === "ready").length;
    const failedRows = workingSheet.rows.filter((row) => row.status === "failed").length;
    await auth.admin
      .from("gallery_sessions")
      .update({
        total_rows: workingSheet.rows.length,
        ready_rows: readyRows,
        failed_rows: failedRows,
        status: workingSheet.rows.length === 0 ? "draft" : "ready",
        error_message: null,
      })
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId);
  }

  const { data: updated } = await auth.admin
    .from("gallery_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  return NextResponse.json(
    { session: updated as GallerySession, worksheet: workingSheet },
    { headers: auth.headers }
  );
}

/** DELETE /api/gallery/sessions/[sessionId]?workspaceId= — admin+ */
export async function DELETE(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  const isAdmin = await requireGalleryAdmin(workspaceId, auth.user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403, headers: auth.headers });
  }

  const session = await loadOwnedSession(auth.admin, sessionId, workspaceId);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: auth.headers });
  }

  const processingIsRecent =
    session.status === "processing" &&
    Date.now() - new Date(session.updated_at).getTime() < 10 * 60 * 1000;
  if (processingIsRecent) {
    return NextResponse.json(
      { error: "Cancel the active generation before deleting this project" },
      { status: 409, headers: auth.headers }
    );
  }

  // Storage is the authoritative home for worksheet, source, generated images,
  // and exports. Only remove the database record after the full prefix is gone.
  await removeGalleryPrefixAdmin(workspaceId, sessionId);

  let deleteError: { message: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await auth.admin
      .from("gallery_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("workspace_id", workspaceId);
    if (!error) {
      deleteError = null;
      break;
    }
    deleteError = error;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
    }
  }
  if (deleteError) {
    galleryWarn("session:delete", "Storage removed but database deletion failed", {
      sessionId,
      error: deleteError.message,
    });
    return NextResponse.json(
      { error: `Storage was removed, but database cleanup failed: ${deleteError.message}` },
      { status: 500, headers: auth.headers }
    );
  }

  return NextResponse.json({ success: true }, { headers: auth.headers });
}
