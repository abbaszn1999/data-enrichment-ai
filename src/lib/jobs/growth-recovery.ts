import type { createAdminClient } from "@/lib/supabase-admin";
import {
  CATALOG_QUEUE_WAIT_MS,
  JOB_HEARTBEAT_STALE_MINUTES,
  JOB_SWEEP_LIMIT,
} from "./config";
import { dispatchJob } from "./dispatch";
import { claimStaleJobRun, finishJobRun, mapJobRun } from "./repo";
import { isTerminalJobStatus, type JobKind, type JobRunRecord } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export const GROWTH_JOB_KINDS: readonly JobKind[] = [
  "mr_stage1",
  "fa_stage1",
  "mr_extract",
  "fa_extract",
  "mr_classify",
  "fa_classify",
  "mr_collections",
];

/** Extract Stop aborts Apify, settles the hold and closes the run itself. */
const SELF_CANCELLING_KINDS = new Set<JobKind>(["mr_extract", "fa_extract"]);

const STALE_MS = JOB_HEARTBEAT_STALE_MINUTES * 60_000;

export type GrowthRecoveryAction = "none" | "redispatch" | "finish_cancelled";

/**
 * Covers what claim_stale_job_runs leaves out: runs that never left "queued"
 * (the dispatch was lost, e.g. a deploy killed the in-process fallback) and
 * runs whose worker died after Stop was pressed. Either would otherwise stay
 * active forever and block every new start for that project.
 */
export function growthRecoveryAction(
  run: Pick<
    JobRunRecord,
    "kind" | "status" | "heartbeat_at" | "cancel_requested" | "task_run_id"
  >,
  now = Date.now()
): GrowthRecoveryAction {
  if (!GROWTH_JOB_KINDS.includes(run.kind)) return "none";
  if (isTerminalJobStatus(run.status)) return "none";
  const beat = run.heartbeat_at ? Date.parse(run.heartbeat_at) : Number.NaN;
  const age = Number.isFinite(beat) ? now - beat : Number.POSITIVE_INFINITY;
  if (run.cancel_requested) {
    if (SELF_CANCELLING_KINDS.has(run.kind)) return "none";
    return age >= STALE_MS ? "finish_cancelled" : "none";
  }
  if (run.status !== "queued") return "none";
  // Accepted by Render but waiting for a free slot: no heartbeat until it starts.
  const wait = run.task_run_id ? CATALOG_QUEUE_WAIT_MS : STALE_MS;
  return age >= wait ? "redispatch" : "none";
}

export async function recoverStuckGrowthJobs(
  admin: Admin,
  now = Date.now()
): Promise<{ redispatched: number; cancelled: number }> {
  const { data, error } = await admin
    .from("job_runs")
    .select("*")
    .in("kind", [...GROWTH_JOB_KINDS])
    .in("status", ["queued", "running"])
    .or("status.eq.queued,cancel_requested.eq.true")
    .lte("heartbeat_at", new Date(now - STALE_MS).toISOString())
    .order("heartbeat_at", { ascending: true })
    .limit(JOB_SWEEP_LIMIT);
  if (error) throw new Error(error.message);

  let redispatched = 0;
  let cancelled = 0;
  for (const row of data ?? []) {
    const run = mapJobRun(row as Record<string, unknown>);
    const action = growthRecoveryAction(run, now);
    if (action === "finish_cancelled") {
      const finished = await finishJobRun(
        admin,
        run.id,
        {
          status: "cancelled",
          completedCount: run.completed_count,
          failedCount: run.failed_count,
        },
        { onlyIfActive: true }
      );
      if (finished) cancelled += 1;
    } else if (action === "redispatch") {
      const wait = run.task_run_id ? CATALOG_QUEUE_WAIT_MS : STALE_MS;
      const claimed = await claimStaleJobRun(
        admin,
        run.id,
        new Date(now - wait).toISOString()
      );
      if (!claimed) continue;
      console.warn("[jobs/growth] run never started; dispatching again", {
        runId: run.id,
        kind: run.kind,
      });
      await dispatchJob(run.id, run.kind);
      redispatched += 1;
    }
  }
  return { redispatched, cancelled };
}
