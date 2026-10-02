import { NextRequest, NextResponse } from "next/server";
import { visualizerRowStoreEnabled } from "@/lib/catalog/flag";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import { collectVisualizerImagePaths } from "@/lib/visualizer/html-embed";
import { visualizerWarn } from "@/lib/visualizer/log";
import { createVisualizerSignedUrlsAdmin } from "@/lib/visualizer/storage-admin";
import type { VisualizerRow } from "@/lib/visualizer/types";
import { jsonByteLength, recordResponseBytes } from "@/lib/observability/metrics";

type Ctx = { params: Promise<{ sessionId: string }> };

const PAGE_LIMIT = 1_000;
/** With no cursor, return what changed recently (covers the gap after a page load). */
const INITIAL_WINDOW_MS = 2 * 60 * 1000;

type StoredRow = {
  row_id: string;
  row_index: number;
  status: string;
  data: Record<string, unknown> | null;
  updated_at: string;
};

/**
 * GET /api/visualizer/sessions/[sessionId]/rows?workspaceId=&since=<cursor>
 *
 * Delta read for the generation poll: only rows whose row-store `updated_at`
 * is after the cursor, plus signed URLs for their stored images. The full
 * worksheet is never read. `supported: false` tells the client to use the
 * full load (row store disabled).
 */
export async function GET(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const auth = await requireVisualizerAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  if (!visualizerRowStoreEnabled()) {
    return NextResponse.json({ supported: false }, { headers: auth.headers });
  }

  const { data: owned } = await auth.admin
    .from("visualizer_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: auth.headers });
  }

  const sinceParam = request.nextUrl.searchParams.get("since");
  const since =
    sinceParam && !Number.isNaN(Date.parse(sinceParam))
      ? sinceParam
      : new Date(Date.now() - INITIAL_WINDOW_MS).toISOString();

  const { data, error } = await auth.admin
    .from("visualizer_session_rows")
    .select("row_id, row_index, status, data, updated_at")
    .eq("session_id", sessionId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(PAGE_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: auth.headers });
  }

  let records = (data ?? []) as StoredRow[];
  let hasMore = false;
  if (records.length === PAGE_LIMIT) {
    hasMore = true;
    // Rows sharing the last timestamp may continue on the next page: hand
    // them out there (cursor stays strictly before them) unless the whole
    // page is one timestamp.
    const last = records[records.length - 1].updated_at;
    const trimmed = records.filter((record) => record.updated_at !== last);
    if (trimmed.length > 0) records = trimmed;
  }

  const rows: VisualizerRow[] = records.map((record) => {
    const payload = (record.data ?? {}) as Partial<VisualizerRow>;
    return {
      ...(payload as VisualizerRow),
      id: record.row_id,
      rowIndex: record.row_index,
      status: record.status as VisualizerRow["status"],
    };
  });

  const paths = [...new Set(rows.flatMap((row) => collectVisualizerImagePaths(row.imagePlaceholders)))];
  let signedUrls: Record<string, string> = {};
  if (paths.length > 0) {
    try {
      signedUrls = await createVisualizerSignedUrlsAdmin(paths, 3600);
    } catch (error) {
      visualizerWarn("rows-delta", "Could not sign image URLs for changed rows", {
        sessionId,
        pathCount: paths.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const unsigned = paths.filter((path) => !signedUrls[path]);
    if (unsigned.length > 0) {
      visualizerWarn("rows-delta", "Some stored images have no signed URL yet", {
        sessionId,
        unsigned: unsigned.length,
      });
    }
  }
  const cursor = records.length > 0 ? records[records.length - 1].updated_at : since;
  const body = { supported: true, rows, signedUrls, cursor, hasMore };
  recordResponseBytes("visualizer.rows-delta", jsonByteLength(body));
  return NextResponse.json(body, { headers: auth.headers });
}
