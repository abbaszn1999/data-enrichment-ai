import { NextRequest, NextResponse } from "next/server";
import {
  extractPollBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { getKeywordProvider } from "@/lib/market-research/providers";
import { nextRowsReturned } from "@/lib/market-research/extract-progress";
import { saveExtractChunkAdmin } from "@/lib/market-research/storage-admin";
import { settleExtractBilling } from "@/lib/market-research/wallet-ops";

export const maxDuration = 60;

const MAX_PARALLEL = 4;

type RunRow = {
  id: string;
  seed_id: string;
  seed_term: string;
  apify_run_id: string | null;
  dataset_id: string | null;
  pages: number;
  status: "running" | "succeeded" | "failed" | "aborted";
  rows_returned: number;
};

async function mapPool<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await mapper(items[index]!);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return out;
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = extractPollBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid poll payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const { data: extract, error: extractError } = await auth.admin
    .from("mr_extracts")
    .select(
      "id, workspace_id, project_id, held_usd, actual_usd, rows_returned, billing_status, status"
    )
    .eq("id", parsed.data.extractId)
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("project_id", parsed.data.projectId)
    .maybeSingle();
  if (extractError) {
    return NextResponse.json(
      { error: extractError.message },
      { status: 500, headers: auth.headers }
    );
  }
  if (!extract) return jsonError("Extract not found", 404);

  const { data: runRows, error: runsError } = await auth.admin
    .from("mr_runs")
    .select(
      "id, seed_id, seed_term, apify_run_id, dataset_id, pages, status, rows_returned"
    )
    .eq("extract_id", extract.id);
  if (runsError) {
    return NextResponse.json(
      { error: runsError.message },
      { status: 500, headers: auth.headers }
    );
  }

  const cursorBySeed = new Map(
    (parsed.data.cursors ?? []).map((row) => [row.seedId, row])
  );
  const provider = getKeywordProvider();
  const runs = (runRows ?? []) as RunRow[];

  const seeds = await mapPool(runs, MAX_PARALLEL, async (run) => {
    const client = cursorBySeed.get(run.seed_id);
    const status = run.status;
    const terminalWithoutCursor =
      (status === "succeeded" && !client?.cursor) ||
      status === "failed" ||
      status === "aborted";
    if (terminalWithoutCursor || !run.apify_run_id) {
      return {
        seedId: run.seed_id,
        term: run.seed_term,
        runId: run.apify_run_id ?? "",
        datasetId: run.dataset_id ?? undefined,
        status,
        rows: [],
        nextCursor: client?.cursor,
        rowsReturned: run.rows_returned,
      };
    }

    try {
      const poll = await provider.pollKeywordIdeas(
        {
          runId: run.apify_run_id,
          datasetId: run.dataset_id ?? undefined,
          seed: run.seed_term,
          database: "",
          pages: run.pages,
        },
        client?.cursor
      );
      const nextStatus =
        poll.status === "succeeded" && poll.nextCursor ? "running" : poll.status;
      const rowsReturned = nextRowsReturned(
        run.rows_returned,
        client?.cursor,
        poll.rows.length
      );
      const datasetId = poll.datasetId || run.dataset_id || undefined;
      if (poll.rows.length > 0) {
        await saveExtractChunkAdmin(auth.admin, {
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
          extractId: extract.id,
          runId: run.apify_run_id,
          seedId: run.seed_id,
          seedTerm: run.seed_term,
          offset: client?.cursor ?? "0",
          rows: poll.rows,
        }).catch(() => undefined);
      }
      await auth.admin
        .from("mr_runs")
        .update({
          status: nextStatus,
          rows_returned: rowsReturned,
          dataset_id: datasetId ?? run.dataset_id,
          error: poll.error ?? null,
        })
        .eq("id", run.id);

      return {
        seedId: run.seed_id,
        term: run.seed_term,
        runId: run.apify_run_id,
        datasetId,
        status: nextStatus,
        rows: poll.rows,
        nextCursor: poll.nextCursor,
        error: poll.error,
        rowsReturned,
      };
    } catch (error) {
      await auth.admin
        .from("mr_runs")
        .update({
          status: "failed",
          error: error instanceof Error ? error.message : "Poll failed",
        })
        .eq("id", run.id);
      return {
        seedId: run.seed_id,
        term: run.seed_term,
        runId: run.apify_run_id,
        datasetId: run.dataset_id ?? undefined,
        status: "failed" as const,
        rows: [],
        nextCursor: client?.cursor,
        error: error instanceof Error ? error.message : "Poll failed",
        rowsReturned: run.rows_returned,
      };
    }
  });

  const allDone = seeds.every(
    (seed) =>
      (seed.status === "succeeded" && !seed.nextCursor) ||
      seed.status === "failed" ||
      seed.status === "aborted"
  );
  const rowsReturned = seeds.reduce((sum, seed) => sum + seed.rowsReturned, 0);

  let settledUsd: number | undefined;
  let billingPending = false;
  if (allDone && extract.billing_status === "held") {
    const settled = await settleExtractBilling(auth.admin, {
      extract,
      userId: auth.user.id,
      rowsReturned,
      status: seeds.every((seed) => seed.status === "aborted")
        ? "aborted"
        : seeds.some((seed) => seed.status === "failed") &&
            seeds.every(
              (seed) => seed.status === "failed" || seed.status === "aborted"
            )
          ? "failed"
          : "succeeded",
    });
    if (settled.pending) billingPending = true;
    else settledUsd = settled.actualUsd;
  }

  return NextResponse.json(
    { seeds, allDone, rowsReturned, settledUsd, billingPending },
    { headers: auth.headers }
  );
}
