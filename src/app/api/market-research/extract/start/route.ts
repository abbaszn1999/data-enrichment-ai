import { NextRequest, NextResponse } from "next/server";
import {
  extractStartBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  estimateExtractCostUsd,
  pagesForEstimate,
  roundUsd,
} from "@/lib/market-research/cost";
import { getKeywordProvider } from "@/lib/market-research/providers";
import { marketToSemrushDb } from "@/lib/market-research/providers/keyword-provider";
import { getMrProject } from "@/lib/market-research/server-persist";
import { chargeMrWallet, refundMrWallet } from "@/lib/market-research/wallet-ops";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = extractStartBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid extract payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const project = await getMrProject(
    auth.admin,
    parsed.data.workspaceId,
    parsed.data.projectId
  );
  if (!project) return jsonError("Project not found", 404);

  const database = marketToSemrushDb(parsed.data.market);
  const provider = getKeywordProvider();
  const extractId = crypto.randomUUID();
  const estimatedRows = parsed.data.seeds.reduce(
    (sum, seed) =>
      sum + Math.min(pagesForEstimate(seed.rawKeywordEstimate) * 100, seed.rawKeywordEstimate),
    0
  );
  const heldUsd = roundUsd(
    parsed.data.seeds.reduce(
      (sum, seed) => sum + estimateExtractCostUsd(seed.rawKeywordEstimate),
      0
    )
  );

  const { error: extractInsertError } = await auth.admin.from("mr_extracts").insert({
    id: extractId,
    workspace_id: parsed.data.workspaceId,
    project_id: parsed.data.projectId,
    created_by: auth.user.id,
    market: parsed.data.market,
    database,
    status: "running",
    estimated_rows: estimatedRows,
    held_usd: heldUsd,
    billing_status: "held",
  });
  if (extractInsertError) {
    return NextResponse.json(
      { error: extractInsertError.message },
      { status: 500, headers: auth.headers }
    );
  }

  const charged = await chargeMrWallet(auth.admin, {
    workspaceId: parsed.data.workspaceId,
    userId: auth.user.id,
    amountUsd: heldUsd,
    description: `Keyword extract hold · ${parsed.data.seeds.length} seeds`,
    idempotencyKey: `apify_keyword_extract:hold:${extractId}`,
    details: { extractId, projectId: parsed.data.projectId, estimatedRows },
  });
  if (!charged.ok) {
    await auth.admin.from("mr_extracts").delete().eq("id", extractId);
    const status = charged.reason === "insufficient_funds" ? 402 : 500;
    return NextResponse.json(
      { error: charged.message || "Not enough wallet balance" },
      { status, headers: auth.headers }
    );
  }

  const started: Array<{
    seedId: string;
    term: string;
    runId: string;
    datasetId?: string;
    pages: number;
    estimatedRows: number;
    estimatedCostUsd: number;
  }> = [];

  try {
    for (const seed of parsed.data.seeds) {
      const pages = pagesForEstimate(seed.rawKeywordEstimate);
      const handle = await provider.startKeywordIdeas(
        seed.term,
        database,
        pages
      );
      started.push({
        seedId: seed.id,
        term: seed.term,
        runId: handle.runId,
        datasetId: handle.datasetId,
        pages: handle.pages,
        estimatedRows: Math.min(pages * 100, seed.rawKeywordEstimate),
        estimatedCostUsd: estimateExtractCostUsd(seed.rawKeywordEstimate),
      });
      const { error: runError } = await auth.admin.from("mr_runs").insert({
        workspace_id: parsed.data.workspaceId,
        project_id: parsed.data.projectId,
        extract_id: extractId,
        kind: "keyword_extract",
        seed_id: seed.id,
        seed_term: seed.term,
        apify_run_id: handle.runId,
        dataset_id: handle.datasetId ?? null,
        pages: handle.pages,
        status: "running",
        estimated_usd: estimateExtractCostUsd(seed.rawKeywordEstimate),
      });
      if (runError) throw runError;
    }
  } catch (error) {
    await Promise.all(
      started.map((row) =>
        provider.abortKeywordIdeas(row.runId).catch(() => undefined)
      )
    );
    await refundMrWallet(auth.admin, {
      workspaceId: parsed.data.workspaceId,
      userId: auth.user.id,
      amountUsd: heldUsd,
      description: "Keyword extract refund · start failed",
      idempotencyKey: `apify_keyword_extract:refund:${extractId}`,
      details: { extractId, failed: true },
    });
    await auth.admin
      .from("mr_extracts")
      .update({ status: "failed", billing_status: "refunded" })
      .eq("id", extractId);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to start extract",
      },
      { status: 502, headers: auth.headers }
    );
  }

  try {
    const { data: workspace } = await auth.admin
      .from("workspaces")
      .select("slug")
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();
    const { insertJobRun } = await import("@/lib/jobs/repo");
    const { dispatchJob } = await import("@/lib/jobs/dispatch");
    const job = await insertJobRun(auth.admin, {
      workspaceId: parsed.data.workspaceId,
      kind: "mr_extract",
      sessionId: extractId,
      createdBy: auth.user.id,
      targetIds: started.map((seed) => seed.seedId),
      settings: {
        projectId: parsed.data.projectId,
        workspaceSlug: workspace?.slug,
        sessionName: project.name,
      },
    });
    await auth.admin
      .from("mr_extracts")
      .update({ job_run_id: job.id })
      .eq("id", extractId);
    await dispatchJob(job.id, "mr_extract");
  } catch (error) {
    console.error(
      "[mr-extract] job_run insert or dispatch failed; client poll remains the pump",
      error instanceof Error ? error.message : error
    );
  }

  return NextResponse.json(
    {
      extractId,
      database,
      heldUsd,
      seeds: started,
    },
    { headers: auth.headers }
  );
}
