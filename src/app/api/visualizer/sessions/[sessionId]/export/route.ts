import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import {
  loadVisualizerWorksheetMatchingRevisionAdmin,
  signVisualizerWorksheetImages,
} from "@/lib/visualizer/storage-admin";
import { buildVisualizerResultsTable } from "@/lib/visualizer/results-xlsx";
import { resolveVisualizerHtmlImages } from "@/lib/visualizer/html-embed";
import { applyVisualizerProjectSettings } from "@/lib/visualizer/types";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import { visualizerWarn } from "@/lib/visualizer/log";
import {
  parseTableExportOptions,
  selectTableColumns,
  serializeTableExport,
  type TableExportOptions,
} from "@/lib/export/table-file";
import { deliverExportFile } from "@/lib/export/deliver";
import { getVisualizerPrefix } from "@/lib/visualizer/storage-paths";

export const maxDuration = 120;

type Ctx = { params: Promise<{ sessionId: string }> };

async function exportVisualizerWorkbook(
  request: NextRequest,
  sessionId: string,
  workspaceId: string,
  options: TableExportOptions = { format: "xlsx" },
  redirect = false
) {
  const auth = await requireVisualizerAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const { data: session, error } = await auth.admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !session) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }

  const worksheet = await loadVisualizerWorksheetMatchingRevisionAdmin(
    workspaceId,
    sessionId,
    Number(session.worksheet_revision ?? 0)
  );
  if (!worksheet) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      { status: 409, headers: { ...auth.headers, "Retry-After": "2" } }
    );
  }

  let settings;
  try {
    settings = parseVisualizerProjectSettings(session.settings);
  } catch {
    settings = worksheet.settings;
  }
  const hydrated = applyVisualizerProjectSettings(worksheet, settings);
  // Only the exported rows need image links; headers still come from the full sheet.
  const exportRows = options.rowIds
    ? hydrated.rows.filter((row) => options.rowIds!.has(row.id))
    : hydrated.rows;

  // Signing is best-effort: export must still succeed with raw HTML if Storage is flaky.
  const signedUrls = await signVisualizerWorksheetImages(
    { ...hydrated, rows: exportRows },
    60 * 60 * 24 * 7
  ).catch((signError) => {
    visualizerWarn("export", "Could not sign image URLs for export", {
      error:
        signError instanceof Error ? signError.message : String(signError),
    });
    return {} as Record<string, string>;
  });

  const resolvedById = new Map(
    exportRows.map((row) => [
      row.id,
      row.generatedDescription
        ? resolveVisualizerHtmlImages(row.generatedDescription, signedUrls)
        : row.generatedDescription,
    ])
  );
  const resolved = {
    ...hydrated,
    rows: hydrated.rows.map((row) =>
      resolvedById.has(row.id)
        ? { ...row, generatedDescription: resolvedById.get(row.id) }
        : row
    ),
  };

  const { buffer, contentType, extension } = await serializeTableExport(
    selectTableColumns(
      buildVisualizerResultsTable(resolved, signedUrls, options.rowIds),
      options.columns
    ),
    options.format
  );
  const safeName = String(session.name || "visualizer")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);

  return deliverExportFile({
    admin: auth.admin,
    path: `${getVisualizerPrefix(workspaceId, sessionId)}/exports/${Date.now()}.${extension}`,
    buffer,
    contentType,
    fileName: `${safeName}-results.${extension}`,
    headers: auth.headers,
    redirect,
    onStorageError: (message) =>
      visualizerWarn("export", "Export storage failed; sending file inline", { error: message }),
  });
}

/**
 * POST /api/visualizer/sessions/[sessionId]/export
 * { workspaceId, format?: "xlsx" | "csv" | "json", rowIds?: string[], columns?: string[] }
 */
export async function POST(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  let body: { workspaceId?: string; format?: unknown; rowIds?: unknown; columns?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceId = body.workspaceId;
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }
  return exportVisualizerWorkbook(
    request,
    sessionId,
    workspaceId,
    parseTableExportOptions(body)
  );
}

/** GET kept for compatibility; prefer POST + blob download like Gallery. */
export async function GET(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  return exportVisualizerWorkbook(request, sessionId, workspaceId, { format: "xlsx" }, true);
}
