import { NextRequest, NextResponse } from "next/server";
import {
  extractCancelBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  abortActiveMrExtractRuns,
  loadMrExtractHeader,
  settleHeldExtract,
} from "@/lib/market-research/extract-advance";
import {
  finishJobRun,
  loadActiveJobForSession,
  requestJobCancel,
} from "@/lib/jobs/repo";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = extractCancelBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid cancel payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const extract = await loadMrExtractHeader(auth.admin, {
    workspaceId: parsed.data.workspaceId,
    projectId: parsed.data.projectId,
    extractId: parsed.data.extractId,
  });
  if (!extract) return jsonError("Extract not found", 404);

  const active = await loadActiveJobForSession(auth.admin, {
    kind: "mr_extract",
    sessionId: extract.id,
    workspaceId: parsed.data.workspaceId,
  });
  const cancelId = active?.id || extract.job_run_id;
  if (cancelId) {
    await requestJobCancel(auth.admin, cancelId, parsed.data.workspaceId).catch(
      () => undefined
    );
  }

  const runs = await abortActiveMrExtractRuns(auth.admin, extract.id);
  const rowsReturned = runs.reduce(
    (sum, run) => sum + (Number(run.rows_returned) || 0),
    0
  );
  const settled = await settleHeldExtract(auth.admin, {
    extract,
    userId: auth.user.id,
    rowsReturned,
    status: "aborted",
    runs,
  });

  if (cancelId) {
    await finishJobRun(auth.admin, cancelId, {
      status: "cancelled",
      completedCount: rowsReturned,
      failedCount: 0,
      lastError: null,
    }).catch(() => undefined);
  }

  return NextResponse.json(
    {
      ok: true,
      rowsReturned,
      settledUsd: settled.settledUsd ?? (Number(extract.actual_usd) || 0),
      billingPending: settled.billingPending,
    },
    { headers: auth.headers }
  );
}
