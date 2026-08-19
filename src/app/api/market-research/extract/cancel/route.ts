import { NextRequest, NextResponse } from "next/server";
import {
  extractCancelBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { getKeywordProvider } from "@/lib/market-research/providers";
import { settleExtractBilling } from "@/lib/market-research/wallet-ops";

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

  const { data: extract } = await auth.admin
    .from("mr_extracts")
    .select(
      "id, workspace_id, project_id, held_usd, actual_usd, rows_returned, billing_status, status"
    )
    .eq("id", parsed.data.extractId)
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("project_id", parsed.data.projectId)
    .maybeSingle();
  if (!extract) return jsonError("Extract not found", 404);

  const { data: runs } = await auth.admin
    .from("mr_runs")
    .select("id, apify_run_id, status, rows_returned")
    .eq("extract_id", extract.id);

  const provider = getKeywordProvider();
  await Promise.all(
    (runs ?? []).map(async (run) => {
      if (!run.apify_run_id) return;
      if (run.status === "succeeded" || run.status === "failed" || run.status === "aborted") {
        return;
      }
      await provider.abortKeywordIdeas(run.apify_run_id).catch(() => undefined);
      await auth.admin
        .from("mr_runs")
        .update({ status: "aborted" })
        .eq("id", run.id);
    })
  );

  const rowsReturned = (runs ?? []).reduce(
    (sum, run) => sum + (Number(run.rows_returned) || 0),
    0
  );
  let settledUsd = Number(extract.actual_usd) || 0;
  let billingPending = false;
  if (extract.billing_status === "held") {
    const settled = await settleExtractBilling(auth.admin, {
      extract,
      userId: auth.user.id,
      rowsReturned,
      status: "aborted",
    });
    if (settled.pending) billingPending = true;
    else settledUsd = settled.actualUsd;
  }

  return NextResponse.json(
    { ok: true, rowsReturned, settledUsd, billingPending },
    { headers: auth.headers }
  );
}
