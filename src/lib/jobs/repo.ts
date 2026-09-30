import { createAdminClient } from "@/lib/supabase-admin";
import type { Json } from "@/types/database";
import {
  asJobSettings,
  type JobKind,
  type JobRunRecord,
  type JobRunSettings,
  type JobRunStatus,
} from "./types";

type Admin = ReturnType<typeof createAdminClient>;

function mapRun(row: Record<string, unknown>): JobRunRecord {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    kind: row.kind as JobKind,
    session_id: String(row.session_id),
    created_by: String(row.created_by),
    status: row.status as JobRunStatus,
    target_ids: Array.isArray(row.target_ids)
      ? row.target_ids.map((id) => String(id))
      : [],
    completed_count: Number(row.completed_count ?? 0),
    failed_count: Number(row.failed_count ?? 0),
    heartbeat_at: (row.heartbeat_at as string | null) ?? null,
    cancel_requested: Boolean(row.cancel_requested),
    task_run_id: (row.task_run_id as string | null) ?? null,
    worker_token: (row.worker_token as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    settings: asJobSettings(row.settings as Json),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function insertJobRun(
  admin: Admin,
  params: {
    workspaceId: string;
    kind: JobKind;
    sessionId: string;
    createdBy: string;
    targetIds: string[];
    settings: JobRunSettings;
  }
): Promise<JobRunRecord> {
  const { data, error } = await admin
    .from("job_runs")
    .insert({
      workspace_id: params.workspaceId,
      kind: params.kind,
      session_id: params.sessionId,
      created_by: params.createdBy,
      status: "queued",
      target_ids: params.targetIds,
      settings: params.settings,
      heartbeat_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Could not create job run");
  }
  return mapRun(data as Record<string, unknown>);
}

/**
 * Starts a job unless one is already active for this session. For the kinds
 * covered by job_runs_one_active_per_session, a concurrent start loses the
 * insert (unique violation) and gets the winner's run instead of a duplicate.
 */
export async function startOrReuseJobRun(
  admin: Admin,
  params: Parameters<typeof insertJobRun>[1]
): Promise<{ job: JobRunRecord; reused: boolean }> {
  const lookup = {
    kind: params.kind,
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
  };
  const existing = await loadActiveJobForSession(admin, lookup);
  if (existing && !existing.cancel_requested) return { job: existing, reused: true };
  if (existing) {
    // Stop was pressed and the worker has not wound down yet; a new start
    // must not attach to the run that is about to end as cancelled.
    await finishJobRun(
      admin,
      existing.id,
      {
        status: "cancelled",
        completedCount: existing.completed_count,
        failedCount: existing.failed_count,
      },
      { onlyIfActive: true }
    );
  }
  try {
    return { job: await insertJobRun(admin, params), reused: false };
  } catch (error) {
    const winner = await loadActiveJobForSession(admin, lookup);
    if (winner) return { job: winner, reused: true };
    throw error;
  }
}

export async function loadJobRun(
  admin: Admin,
  id: string
): Promise<JobRunRecord | null> {
  const { data, error } = await admin
    .from("job_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRun(data as Record<string, unknown>) : null;
}

export async function loadActiveJobForSession(
  admin: Admin,
  params: { kind: JobKind; sessionId: string; workspaceId: string }
): Promise<JobRunRecord | null> {
  const { data, error } = await admin
    .from("job_runs")
    .select("*")
    .eq("kind", params.kind)
    .eq("session_id", params.sessionId)
    .eq("workspace_id", params.workspaceId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRun(data as Record<string, unknown>) : null;
}

export async function listActiveJobsForUser(
  admin: Admin,
  params: { workspaceId: string; userId: string }
): Promise<JobRunRecord[]> {
  const { data, error } = await admin
    .from("job_runs")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("created_by", params.userId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapRun(row as Record<string, unknown>));
}

export async function markJobRunning(
  admin: Admin,
  id: string,
  taskRunId?: string | null,
  workerToken?: string
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: "running",
    heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (taskRunId) patch.task_run_id = taskRunId;
  if (workerToken) patch.worker_token = workerToken;
  const { error } = await admin.from("job_runs").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * With `workerToken`, the write only lands while that worker still owns the
 * run — a superseded worker's heartbeat/progress becomes a no-op.
 */
export async function touchJobHeartbeat(
  admin: Admin,
  id: string,
  counts?: { completed?: number; failed?: number; settings?: JobRunSettings },
  workerToken?: string
): Promise<JobRunRecord | null> {
  const patch: Record<string, unknown> = {
    heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (typeof counts?.completed === "number") patch.completed_count = counts.completed;
  if (typeof counts?.failed === "number") patch.failed_count = counts.failed;
  if (counts?.settings) patch.settings = counts.settings;
  let query = admin.from("job_runs").update(patch).eq("id", id);
  if (workerToken) query = query.eq("worker_token", workerToken);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRun(data as Record<string, unknown>) : null;
}

export async function finishJobRun(
  admin: Admin,
  id: string,
  params: {
    status: Exclude<JobRunStatus, "queued" | "running">;
    completedCount: number;
    failedCount: number;
    lastError?: string | null;
  },
  guard?: {
    /** Only the worker that owns the run may finish it. */
    workerToken?: string;
    /** Never overwrite a status that is already terminal (e.g. a forced Stop). */
    onlyIfActive?: boolean;
    /** Only a run no worker has started yet (still waiting in the queue). */
    onlyIfQueued?: boolean;
  }
): Promise<JobRunRecord | null> {
  let query = admin
    .from("job_runs")
    .update({
      status: params.status,
      completed_count: params.completedCount,
      failed_count: params.failedCount,
      last_error: params.lastError ?? null,
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (guard?.workerToken) query = query.eq("worker_token", guard.workerToken);
  if (guard?.onlyIfActive) query = query.in("status", ["queued", "running"]);
  if (guard?.onlyIfQueued) query = query.eq("status", "queued");
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRun(data as Record<string, unknown>) : null;
}

export type JobControl = {
  /** The user pressed Stop, or the run already ended (e.g. a forced finish). */
  stop: boolean;
  /** Another orchestrator took over this run; leave it alone entirely. */
  superseded: boolean;
};

/** What a running worker must check before claiming each new row. */
export async function readJobControl(
  admin: Admin,
  id: string,
  workerToken?: string
): Promise<JobControl> {
  const { data, error } = await admin
    .from("job_runs")
    .select("cancel_requested, status, worker_token")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { stop: true, superseded: true };
  const superseded =
    !!workerToken && !!data.worker_token && data.worker_token !== workerToken;
  const terminal = !["queued", "running"].includes(String(data.status));
  return { stop: Boolean(data.cancel_requested) || terminal, superseded };
}

/**
 * Atomically take over one stale run (heartbeat older than `staleBefore`) so
 * only a single caller re-dispatches it, however many pollers race here.
 */
export async function claimStaleJobRun(
  admin: Admin,
  id: string,
  staleBefore: string
): Promise<JobRunRecord | null> {
  const { data, error } = await admin
    .from("job_runs")
    .update({
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["queued", "running"])
    .eq("cancel_requested", false)
    .lte("heartbeat_at", staleBefore)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRun(data as Record<string, unknown>) : null;
}

export async function requestJobCancel(
  admin: Admin,
  id: string,
  workspaceId: string
): Promise<JobRunRecord | null> {
  const { data, error } = await admin.rpc("cancel_job_run", {
    p_id: id,
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapRun(row as Record<string, unknown>) : null;
}

export async function claimStaleJobRuns(
  admin: Admin,
  staleMinutes = 10,
  limit = 5
): Promise<JobRunRecord[]> {
  const { data, error } = await admin.rpc("claim_stale_job_runs", {
    p_stale_minutes: staleMinutes,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => mapRun(row));
}

export { mapRun as mapJobRun };

export async function isJobCancelRequested(
  admin: Admin,
  id: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("job_runs")
    .select("cancel_requested, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return true;
  return Boolean(data.cancel_requested) || data.status === "cancelled";
}
