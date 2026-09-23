import { NextRequest, NextResponse } from "next/server";
import {
  extractStartBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  cappedKeywordEstimate,
  estimateExtractCostUsd,
  EXTRACT_CAP_PER_SEED,
  RAW_KEYWORD_SELECTION_CAP,
  roundUsd,
} from "@/lib/market-research/cost";
import { getKeywordProvider } from "@/lib/market-research/providers";
import { marketToSemrushDb } from "@/lib/market-research/providers/keyword-provider";
import { getMrProject, loadProjectProbesAdmin } from "@/lib/market-research/server-persist";
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

  // Price the hold from the demand check saved on the server, not the
  // estimate in the request. A seed without a saved result holds the full
  // per-seed cap; the unused part is refunded when the extract settles.
  const savedProbes = await loadProjectProbesAdmin(auth.admin, parsed.data.projectId).catch(
    () => ({} as Record<string, { rawKeywords?: number; failed?: boolean }>)
  );
  const seeds = parsed.data.seeds.map((seed) => {
    const probe = savedProbes[seed.id];
    const rawKeywordEstimate =
      probe && !probe.failed && typeof probe.rawKeywords === "number"
        ? Math.max(0, Math.floor(probe.rawKeywords))
        : EXTRACT_CAP_PER_SEED;
    return { ...seed, rawKeywordEstimate };
  });
  const estimatedRows = seeds.reduce(
    (sum, seed) => sum + cappedKeywordEstimate(seed.rawKeywordEstimate),
    0
  );
  if (estimatedRows > RAW_KEYWORD_SELECTION_CAP) {
    return jsonError(
      `This selection is ${estimatedRows.toLocaleString("en-US")} raw keywords. The maximum is ${RAW_KEYWORD_SELECTION_CAP.toLocaleString("en-US")}. Deselect seeds and try again.`,
      400
    );
  }

  const database = marketToSemrushDb(parsed.data.market);
  const provider = getKeywordProvider();
  const extractId = crypto.randomUUID();
  const heldUsd = roundUsd(
    seeds.reduce((sum, seed) => sum + estimateExtractCostUsd(seed.rawKeywordEstimate), 0)
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
    description: `Keyword extract hold · ${seeds.length} seeds`,
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
    limitPerSeed: number;
    estimatedRows: number;
    estimatedCostUsd: number;
  }> = [];

  try {
    for (const seed of seeds) {
      const handle = await provider.startKeywordIdeas(seed.term, database, {
        limitPerSeed: EXTRACT_CAP_PER_SEED,
        minVolume: parsed.data.minVolume,
        maxDifficulty: parsed.data.maxDifficulty,
      });
      started.push({
        seedId: seed.id,
        term: seed.term,
        runId: handle.runId,
        datasetId: handle.datasetId,
        limitPerSeed: handle.limitPerSeed,
        estimatedRows: cappedKeywordEstimate(seed.rawKeywordEstimate),
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
        // `pages` column (unchanged) now stores `limitPerSeed`.
        pages: handle.limitPerSeed,
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
    // Never forward the raw provider error to the client — it can carry our
    // vendor's name, actor ids, or request paths in its message.
    console.error("[mr-extract] Failed to start extract:", error);
    return NextResponse.json(
      { error: "Failed to start extraction. You have not been charged." },
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
