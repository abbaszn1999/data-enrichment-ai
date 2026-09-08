import type { SupabaseClient } from "@supabase/supabase-js";
import { getKeywordProvider } from "@/lib/market-research/providers";
import type {
  KeywordDataProvider,
  KeywordIdeasPoll,
  KeywordRow,
} from "@/lib/market-research/providers/keyword-provider";
import { nextRowsReturned } from "@/lib/market-research/extract-progress";
import {
  loadExtractRowsAdmin,
  saveExtractChunkAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import {
  SAMPLE_CAP,
  toExtractedKeyword,
  type DisplayKeyword,
} from "@/lib/market-research/map-keywords";
import { settleExtractBilling } from "@/lib/market-research/wallet-ops";

export const EXTRACT_LEASE_MS = 25_000;
export const EXTRACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Admin = SupabaseClient;

export type ExtractSeedStatus = "running" | "succeeded" | "failed" | "aborted";

export type ExtractRunRow = {
  id: string;
  seed_id: string;
  seed_term: string;
  apify_run_id: string | null;
  dataset_id: string | null;
  pages: number;
  status: ExtractSeedStatus;
  rows_returned: number;
  next_cursor: string | null;
};

export type ExtractHeader = {
  id: string;
  workspace_id: string;
  project_id: string;
  created_by: string;
  held_usd: number | string;
  actual_usd: number | string;
  rows_returned: number;
  billing_status: string;
  status: string;
  created_at: string;
  job_run_id: string | null;
};

export type AdvancedSeed = {
  seedId: string;
  term: string;
  runId: string;
  datasetId?: string;
  status: ExtractSeedStatus;
  rows: KeywordRow[];
  nextCursor?: string;
  error?: string;
  rowsReturned: number;
};

export type ExtractAdvanceResult = {
  extract: ExtractHeader;
  seeds: AdvancedSeed[];
  allDone: boolean;
  rowsReturned: number;
  settledUsd?: number;
  billingPending: boolean;
  leased: boolean;
  sample?: DisplayKeyword[];
};

export function seedIsFinished(
  status: string,
  nextCursor?: string | null
): boolean {
  return (
    (status === "succeeded" && !nextCursor) ||
    status === "failed" ||
    status === "aborted"
  );
}

export function nextStoredCursor(poll: {
  status: string;
  nextCursor?: string;
}): string | null {
  if (poll.status === "failed" || poll.status === "aborted") return null;
  if (poll.status === "succeeded" && !poll.nextCursor) return null;
  return poll.nextCursor ?? null;
}

export function pollStatusForStore(
  poll: Pick<KeywordIdeasPoll, "status" | "nextCursor">
): ExtractSeedStatus {
  if (poll.status === "succeeded" && poll.nextCursor) return "running";
  return poll.status;
}

export function settleStatusFromSeeds(
  seeds: Array<{ status: string }>
): "succeeded" | "failed" | "aborted" {
  if (seeds.length === 0) return "failed";
  if (seeds.some((seed) => seed.status === "aborted")) return "aborted";
  if (
    seeds.some((seed) => seed.status === "failed") &&
    seeds.every(
      (seed) => seed.status === "failed" || seed.status === "aborted"
    )
  ) {
    return "failed";
  }
  return "succeeded";
}

export function isExtractTimedOut(createdAt: string, now = Date.now()): boolean {
  const started = Date.parse(createdAt);
  if (!Number.isFinite(started)) return false;
  return now - started > EXTRACT_MAX_AGE_MS;
}

export async function tryLeaseMrExtract(
  admin: Admin,
  extractId: string,
  leaseMs = EXTRACT_LEASE_MS
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  const { data, error } = await admin
    .from("mr_extracts")
    .update({ pump_lease_until: leaseUntil })
    .eq("id", extractId)
    .or(`pump_lease_until.is.null,pump_lease_until.lt.${nowIso}`)
    .select("id")
    .maybeSingle();
  if (error) {
    // Column missing (migration not applied): allow a single in-process pump.
    if (/pump_lease_until/i.test(error.message)) return true;
    throw error;
  }
  return Boolean(data);
}

export async function loadMrExtractHeader(
  admin: Admin,
  params: { workspaceId: string; projectId: string; extractId: string }
): Promise<ExtractHeader | null> {
  const { data, error } = await admin
    .from("mr_extracts")
    .select(
      "id, workspace_id, project_id, created_by, held_usd, actual_usd, rows_returned, billing_status, status, created_at, job_run_id"
    )
    .eq("id", params.extractId)
    .eq("workspace_id", params.workspaceId)
    .eq("project_id", params.projectId)
    .maybeSingle();
  if (error) {
    if (/job_run_id/i.test(error.message)) {
      const fallback = await admin
        .from("mr_extracts")
        .select(
          "id, workspace_id, project_id, created_by, held_usd, actual_usd, rows_returned, billing_status, status, created_at"
        )
        .eq("id", params.extractId)
        .eq("workspace_id", params.workspaceId)
        .eq("project_id", params.projectId)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      if (!fallback.data) return null;
      return { ...(fallback.data as Omit<ExtractHeader, "job_run_id">), job_run_id: null };
    }
    throw error;
  }
  return (data as ExtractHeader | null) ?? null;
}

export async function loadLatestMrExtract(
  admin: Admin,
  params: { workspaceId: string; projectId: string }
): Promise<ExtractHeader | null> {
  const { data, error } = await admin
    .from("mr_extracts")
    .select(
      "id, workspace_id, project_id, created_by, held_usd, actual_usd, rows_returned, billing_status, status, created_at, job_run_id"
    )
    .eq("workspace_id", params.workspaceId)
    .eq("project_id", params.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (/job_run_id/i.test(error.message)) {
      const fallback = await admin
        .from("mr_extracts")
        .select(
          "id, workspace_id, project_id, created_by, held_usd, actual_usd, rows_returned, billing_status, status, created_at"
        )
        .eq("workspace_id", params.workspaceId)
        .eq("project_id", params.projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      if (!fallback.data) return null;
      return { ...(fallback.data as Omit<ExtractHeader, "job_run_id">), job_run_id: null };
    }
    throw error;
  }
  return (data as ExtractHeader | null) ?? null;
}

async function loadExtractRuns(
  admin: Admin,
  extractId: string
): Promise<ExtractRunRow[]> {
  const { data, error } = await admin
    .from("mr_runs")
    .select(
      "id, seed_id, seed_term, apify_run_id, dataset_id, pages, status, rows_returned, next_cursor"
    )
    .eq("extract_id", extractId);
  if (error) {
    if (/next_cursor/i.test(error.message)) {
      const fallback = await admin
        .from("mr_runs")
        .select(
          "id, seed_id, seed_term, apify_run_id, dataset_id, pages, status, rows_returned"
        )
        .eq("extract_id", extractId);
      if (fallback.error) throw fallback.error;
      return ((fallback.data ?? []) as Omit<ExtractRunRow, "next_cursor">[]).map(
        (row) => ({ ...row, next_cursor: null })
      );
    }
    throw error;
  }
  return (data ?? []) as ExtractRunRow[];
}

const MAX_PARALLEL = 4;

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

async function updateExtractRun(
  admin: Admin,
  runId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const apply = async (fields: Record<string, unknown>) =>
    admin
      .from("mr_runs")
      .update(fields)
      .eq("id", runId)
      .eq("status", "running");

  const { error } = await apply(patch);
  if (!error) return;
  if (/next_cursor/i.test(error.message) && "next_cursor" in patch) {
    const rest = { ...patch };
    delete rest.next_cursor;
    const fallback = await apply(rest);
    if (fallback.error) throw fallback.error;
    return;
  }
  throw error;
}

async function releaseMrExtractLease(
  admin: Admin,
  extractId: string
): Promise<void> {
  const { error } = await admin
    .from("mr_extracts")
    .update({ pump_lease_until: null })
    .eq("id", extractId);
  if (error && !/pump_lease_until/i.test(error.message)) {
    console.error("[extract] lease release failed", error.message);
  }
}

function snapshotSeed(run: ExtractRunRow): AdvancedSeed {
  return {
    seedId: run.seed_id,
    term: run.seed_term,
    runId: run.apify_run_id ?? "",
    datasetId: run.dataset_id ?? undefined,
    status: run.status,
    rows: [],
    nextCursor: run.next_cursor ?? undefined,
    rowsReturned: run.rows_returned,
  };
}

export async function persistExtractKeywordSample(
  admin: Admin,
  params: {
    workspaceId: string;
    projectId: string;
    extractId: string;
    runs: Array<{ seed_id: string; seed_term: string }>;
  }
): Promise<DisplayKeyword[]> {
  const rows = await loadExtractRowsAdmin(
    admin,
    params.workspaceId,
    params.projectId,
    params.extractId
  );
  const seedIdByTerm = new Map(
    params.runs.map((run) => [run.seed_term.trim().toLowerCase(), run.seed_id])
  );
  const sample: DisplayKeyword[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const seedId =
      seedIdByTerm.get(row.seed.trim().toLowerCase()) ?? row.seed ?? "seed";
    sample.push(toExtractedKeyword(row, seedId, index));
    if (sample.length >= SAMPLE_CAP) break;
  }
  await saveProjectSliceAdmin(
    admin,
    params.workspaceId,
    params.projectId,
    "keywords",
    sample
  ).catch((err) =>
    console.error("[extract] Error saving keyword sample:", err)
  );
  return sample;
}

export async function abortActiveMrExtractRuns(
  admin: Admin,
  extractId: string,
  provider?: KeywordDataProvider
): Promise<ExtractRunRow[]> {
  const runs = await loadExtractRuns(admin, extractId);
  const keywordProvider = provider ?? getKeywordProvider();
  await Promise.all(
    runs.map(async (run) => {
      if (!run.apify_run_id) return;
      if (seedIsFinished(run.status, run.next_cursor)) return;
      await keywordProvider.abortKeywordIdeas(run.apify_run_id).catch(() => undefined);
      const { error } = await admin
        .from("mr_runs")
        .update({ status: "aborted", next_cursor: null })
        .eq("id", run.id);
      if (error && /next_cursor/i.test(error.message)) {
        await admin.from("mr_runs").update({ status: "aborted" }).eq("id", run.id);
      }
    })
  );
  return loadExtractRuns(admin, extractId);
}

export async function settleHeldExtract(
  admin: Admin,
  params: {
    extract: ExtractHeader;
    userId: string;
    rowsReturned: number;
    status: "succeeded" | "failed" | "aborted";
    runs: Array<{ seed_id: string; seed_term: string }>;
  }
): Promise<{ settledUsd?: number; billingPending: boolean; sample?: DisplayKeyword[] }> {
  if (params.extract.billing_status !== "held") {
    return { billingPending: false };
  }
  const settled = await settleExtractBilling(admin, {
    extract: params.extract,
    userId: params.userId,
    rowsReturned: params.rowsReturned,
    status: params.status,
  });
  if (settled.pending) return { billingPending: true };
  const sample = await persistExtractKeywordSample(admin, {
    workspaceId: params.extract.workspace_id,
    projectId: params.extract.project_id,
    extractId: params.extract.id,
    runs: params.runs,
  }).catch(() => undefined);
  return { settledUsd: settled.actualUsd, billingPending: false, sample };
}

export async function expireStaleHeldExtracts(
  admin: Admin,
  limit = 5
): Promise<number> {
  const cutoff = new Date(Date.now() - EXTRACT_MAX_AGE_MS).toISOString();
  const { data, error } = await admin
    .from("mr_extracts")
    .select(
      "id, workspace_id, project_id, created_by, held_usd, actual_usd, rows_returned, billing_status, status, created_at, job_run_id"
    )
    .eq("billing_status", "held")
    .lt("created_at", cutoff)
    .limit(limit);
  if (error) {
    if (/job_run_id/i.test(error.message)) {
      const fallback = await admin
        .from("mr_extracts")
        .select(
          "id, workspace_id, project_id, created_by, held_usd, actual_usd, rows_returned, billing_status, status, created_at"
        )
        .eq("billing_status", "held")
        .lt("created_at", cutoff)
        .limit(limit);
      if (fallback.error) throw fallback.error;
      const rows = ((fallback.data ?? []) as Omit<ExtractHeader, "job_run_id">[]).map(
        (row) => ({ ...row, job_run_id: null })
      );
      let expired = 0;
      for (const row of rows) {
        if (!isExtractTimedOut(row.created_at)) continue;
        const runs = await abortActiveMrExtractRuns(admin, row.id);
        const rowsReturned = runs.reduce(
          (sum, run) => sum + (Number(run.rows_returned) || 0),
          0
        );
        await settleHeldExtract(admin, {
          extract: row,
          userId: row.created_by,
          rowsReturned,
          status: "failed",
          runs,
        });
        expired += 1;
      }
      return expired;
    }
    throw error;
  }
  let expired = 0;
  for (const row of (data ?? []) as ExtractHeader[]) {
    if (!isExtractTimedOut(row.created_at)) continue;
    const runs = await abortActiveMrExtractRuns(admin, row.id);
    const rowsReturned = runs.reduce(
      (sum, run) => sum + (Number(run.rows_returned) || 0),
      0
    );
    await settleHeldExtract(admin, {
      extract: row,
      userId: row.created_by,
      rowsReturned,
      status: "failed",
      runs,
    });
    expired += 1;
  }
  return expired;
}

export async function advanceMrExtract(
  admin: Admin,
  params: {
    workspaceId: string;
    projectId: string;
    extractId: string;
    userId: string;
    provider?: KeywordDataProvider;
    /** Used only when `mr_runs.next_cursor` is empty (migration not applied). */
    clientCursors?: Array<{ seedId: string; cursor?: string }>;
  }
): Promise<ExtractAdvanceResult> {
  const extract = await loadMrExtractHeader(admin, params);
  if (!extract) {
    throw new Error("Extract not found");
  }

  const runs = await loadExtractRuns(admin, extract.id);
  const leased = await tryLeaseMrExtract(admin, extract.id);
  if (!leased) {
    const seeds = runs.map(snapshotSeed);
    const allDone = seeds.every((seed) =>
      seedIsFinished(seed.status, seed.nextCursor)
    );
    return {
      extract,
      seeds,
      allDone,
      rowsReturned: seeds.reduce((sum, seed) => sum + seed.rowsReturned, 0),
      billingPending: allDone && extract.billing_status === "held",
      leased: false,
    };
  }

  const provider = params.provider ?? getKeywordProvider();
  const clientCursorBySeed = new Map(
    (params.clientCursors ?? []).map((row) => [row.seedId, row.cursor])
  );

  try {
    const polled = await mapPool(runs, MAX_PARALLEL, async (run) => {
      if (seedIsFinished(run.status, run.next_cursor) || !run.apify_run_id) {
        return snapshotSeed(run);
      }
      const cursor =
        run.next_cursor ?? clientCursorBySeed.get(run.seed_id) ?? undefined;

      try {
        const poll = await provider.pollKeywordIdeas(
          {
            runId: run.apify_run_id,
            datasetId: run.dataset_id ?? undefined,
            seed: run.seed_term,
            database: "",
            pages: run.pages,
          },
          cursor
        );
        const nextStatus = pollStatusForStore(poll);
        const storedCursor = nextStoredCursor(poll);
        const rowsReturned = nextRowsReturned(
          run.rows_returned,
          cursor,
          poll.rows.length
        );
        const datasetId = poll.datasetId || run.dataset_id || undefined;
        if (poll.rows.length > 0) {
          await saveExtractChunkAdmin(admin, {
            workspaceId: params.workspaceId,
            projectId: params.projectId,
            extractId: extract.id,
            runId: run.apify_run_id,
            seedId: run.seed_id,
            seedTerm: run.seed_term,
            offset: cursor ?? "0",
            rows: poll.rows,
          }).catch(() => undefined);
        }
        await updateExtractRun(admin, run.id, {
          status: nextStatus,
          rows_returned: rowsReturned,
          dataset_id: datasetId ?? run.dataset_id,
          next_cursor: storedCursor,
          error: poll.error ?? null,
        });

        return {
          seedId: run.seed_id,
          term: run.seed_term,
          runId: run.apify_run_id,
          datasetId,
          status: nextStatus,
          rows: poll.rows,
          nextCursor: storedCursor ?? undefined,
          error: poll.error,
          rowsReturned,
        } satisfies AdvancedSeed;
      } catch (error) {
        await updateExtractRun(admin, run.id, {
          status: "failed",
          next_cursor: null,
          error: error instanceof Error ? error.message : "Poll failed",
        }).catch(() => undefined);
        return {
          seedId: run.seed_id,
          term: run.seed_term,
          runId: run.apify_run_id,
          datasetId: run.dataset_id ?? undefined,
          status: "failed" as const,
          rows: [],
          rowsReturned: run.rows_returned,
          error: error instanceof Error ? error.message : "Poll failed",
        };
      }
    });

    const dbRuns = await loadExtractRuns(admin, extract.id);
    const polledBySeed = new Map(polled.map((seed) => [seed.seedId, seed]));
    const seeds = dbRuns.map((run) => {
      const fromPoll = polledBySeed.get(run.seed_id);
      if (!fromPoll || run.status === "aborted") return snapshotSeed(run);
      return {
        ...fromPoll,
        status: run.status,
        nextCursor: run.next_cursor ?? undefined,
        rowsReturned: run.rows_returned,
        rows: run.status === "failed" ? [] : fromPoll.rows,
      };
    });

    const allDone = seeds.every((seed) =>
      seedIsFinished(seed.status, seed.nextCursor)
    );
    const rowsReturned = seeds.reduce((sum, seed) => sum + seed.rowsReturned, 0);

    try {
      await admin
        .from("mr_extracts")
        .update({ rows_returned: rowsReturned })
        .eq("id", extract.id)
        .eq("billing_status", "held");
    } catch {
      // Progress write is best-effort; settlement still uses seed totals.
    }

    const latest = (await loadMrExtractHeader(admin, params)) ?? extract;
    let settledUsd: number | undefined;
    let billingPending = false;
    let sample: DisplayKeyword[] | undefined;
    if (allDone && latest.billing_status === "held") {
      const settled = await settleHeldExtract(admin, {
        extract: latest,
        userId: params.userId,
        rowsReturned,
        status: settleStatusFromSeeds(seeds),
        runs: dbRuns,
      });
      billingPending = settled.billingPending;
      settledUsd = settled.settledUsd;
      sample = settled.sample;
    }

    return {
      extract: latest,
      seeds,
      allDone,
      rowsReturned,
      settledUsd,
      billingPending,
      leased: true,
      sample,
    };
  } finally {
    await releaseMrExtractLease(admin, extract.id);
  }
}
