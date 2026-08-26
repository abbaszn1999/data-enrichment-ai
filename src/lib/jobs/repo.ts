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
  taskRunId?: string | null
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: "running",
    heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (taskRunId) patch.task_run_id = taskRunId;
  const { error } = await admin.from("job_runs").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function touchJobHeartbeat(
  admin: Admin,
  id: string,
  counts?: { completed?: number; failed?: number; settings?: JobRunSettings }
): Promise<JobRunRecord | null> {
  const patch: Record<string, unknown> = {
    heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (typeof counts?.completed === "number") patch.completed_count = counts.completed;
  if (typeof counts?.failed === "number") patch.failed_count = counts.failed;
  if (counts?.settings) patch.settings = counts.settings;
  const { data, error } = await admin
    .from("job_runs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
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
  }
): Promise<JobRunRecord | null> {
  const { data, error } = await admin
    .from("job_runs")
    .update({
      status: params.status,
      completed_count: params.completedCount,
      failed_count: params.failedCount,
      last_error: params.lastError ?? null,
      heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
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
