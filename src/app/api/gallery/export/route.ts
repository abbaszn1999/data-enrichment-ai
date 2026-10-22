import { NextRequest, NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { isContextSubscriptionActive } from "@/lib/workspace-context";
import { buildGalleryExportTable } from "@/lib/gallery/export-builder";
import { loadGalleryWorksheetMatchingRevisionAdmin } from "@/lib/gallery/storage-admin";
import { getGalleryExportPath } from "@/lib/gallery/storage-paths";
import { galleryWarn } from "@/lib/gallery/log";
import { parseGalleryProjectSettings } from "@/lib/gallery/settings-schema";
import {
  applyGalleryProjectSettings,
  getGalleryProjectSettingsFromWorksheet,
} from "@/lib/gallery/types";
import {
  parseTableExportOptions,
  selectTableColumns,
  serializeTableExport,
} from "@/lib/export/table-file";
import { deliverExportFile } from "@/lib/export/deliver";
import {
  PLATFORM_IMAGE_LINK_TTL_SEC,
  parseTablePlatformOptions,
  serializeTablePlatformExport,
} from "@/lib/export/table-platform";
import { collectGalleryImagePaths } from "@/lib/gallery/signed-urls";
import { createSignedUrlsAdmin } from "@/lib/gallery/storage-admin";

export const maxDuration = 120;

/**
 * POST /api/gallery/export
 * { workspaceId, sessionId, format?: "xlsx" | "csv" | "json", rowIds?: string[], columns?: string[] }
 * With { platform: "shopify" | "woocommerce" | "magento", mode?, mapping } it
 * returns that store's import CSV instead, with directly downloadable image links.
 */
export async function POST(request: NextRequest) {
  let body: {
    workspaceId?: string;
    sessionId?: string;
    format?: unknown;
    rowIds?: unknown;
    columns?: unknown;
    platform?: unknown;
    mode?: unknown;
    mapping?: unknown;
  };
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
  const options = parseTableExportOptions(body);
  const platformOptions = parseTablePlatformOptions(body);

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

  // A store downloads each picture on import, so it needs plain signed links
  // instead of the app's own image route, which asks for a login.
  const storeLinks = platformOptions
    ? await createSignedUrlsAdmin(
        collectGalleryImagePaths(worksheet, options.rowIds ? [...options.rowIds] : undefined),
        PLATFORM_IMAGE_LINK_TTL_SEC
      )
    : null;
  const table = await buildGalleryExportTable(
    worksheet,
    async (path) => {
      if (storeLinks) {
        return storeLinks[path] ?? (await createSignedUrlsAdmin([path], PLATFORM_IMAGE_LINK_TTL_SEC))[path] ?? null;
      }
      const url = new URL("/api/gallery/images", request.nextUrl.origin);
      url.searchParams.set("workspaceId", workspaceId);
      url.searchParams.set("sessionId", sessionId);
      url.searchParams.set("path", path);
      return url.toString();
    },
    options.rowIds
  );
  const { buffer, contentType, extension } = platformOptions
    ? await serializeTablePlatformExport(table, platformOptions)
    : await serializeTableExport(selectTableColumns(table, options.columns), options.format);
  const fileSuffix = platformOptions ? `${platformOptions.platform}_${platformOptions.mode}` : "export";

  return deliverExportFile({
    admin: auth.admin,
    path: getGalleryExportPath(workspaceId, sessionId, extension),
    buffer,
    contentType,
    fileName: `${(session.name || "gallery").replace(/[^\w.-]+/g, "_")}_${fileSuffix}.${extension}`,
    headers: auth.headers,
    onStorageError: (error) =>
      galleryWarn("export", "Export storage failed; sending file inline", { error }),
  });
}
