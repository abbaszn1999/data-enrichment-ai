import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import {
  loadVisualizerWorksheetMatchingRevisionAdmin,
  signVisualizerWorksheetImages,
} from "@/lib/visualizer/storage-admin";
import { buildVisualizerResultsBuffer } from "@/lib/visualizer/results-xlsx";
import { resolveVisualizerHtmlImages } from "@/lib/visualizer/html-embed";
import { applyVisualizerProjectSettings } from "@/lib/visualizer/types";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import { visualizerWarn } from "@/lib/visualizer/log";

export const maxDuration = 120;

type Ctx = { params: Promise<{ sessionId: string }> };

async function exportVisualizerWorkbook(
  request: NextRequest,
  sessionId: string,
  workspaceId: string
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

  // Signing is best-effort: export must still succeed with raw HTML if Storage is flaky.
  const signedUrls = await signVisualizerWorksheetImages(
    hydrated,
    60 * 60 * 24 * 7
  ).catch((signError) => {
    visualizerWarn("export", "Could not sign image URLs for export", {
      error:
        signError instanceof Error ? signError.message : String(signError),
    });
    return {} as Record<string, string>;
  });

  const resolved = {
    ...hydrated,
    rows: hydrated.rows.map((row) => ({
      ...row,
      generatedDescription: row.generatedDescription
        ? resolveVisualizerHtmlImages(row.generatedDescription, signedUrls)
        : row.generatedDescription,
    })),
  };

  const buffer = await buildVisualizerResultsBuffer(resolved, signedUrls);
  const safeName = String(session.name || "visualizer")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      ...auth.headers,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}-results.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/** POST /api/visualizer/sessions/[sessionId]/export — { workspaceId } */
export async function POST(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  let body: { workspaceId?: string };
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
  return exportVisualizerWorkbook(request, sessionId, workspaceId);
}

/** GET kept for compatibility; prefer POST + blob download like Gallery. */
export async function GET(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  return exportVisualizerWorkbook(request, sessionId, workspaceId);
}
