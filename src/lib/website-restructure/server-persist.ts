import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteWrProjectStorageFolder } from "./storage";
import {
  EMPTY_WR_STATE,
  WR_MAX_EDIT_MESSAGES,
  type WrPhase,
  type WrProjectRow,
  type WrProjectState,
} from "./types";

type Admin = SupabaseClient;

const ROW_COLUMNS =
  "id, workspace_id, created_by, name, status, provider, phase, edit_messages_used, active_version, last_error, state, created_at, updated_at";

type WrProjectDbRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  status: "active" | "completed";
  provider: string;
  phase: WrPhase;
  edit_messages_used: number;
  active_version: number;
  last_error: string | null;
  state: unknown;
  created_at: string;
  updated_at: string;
};

function normalizeState(raw: unknown): WrProjectState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_WR_STATE };
  const s = raw as Partial<WrProjectState>;
  return {
    chat: Array.isArray(s.chat) ? s.chat : [],
    images: Array.isArray(s.images) ? s.images : [],
    logo: s.logo && typeof s.logo === "object" ? s.logo : null,
    competitors: Array.isArray(s.competitors) ? s.competitors : [],
    competitorsSkipped: Boolean(s.competitorsSkipped),
  };
}

function rowToWrProjectRow(row: WrProjectDbRow): WrProjectRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    status: row.status,
    provider: row.provider,
    phase: row.phase,
    editMessagesUsed: row.edit_messages_used,
    activeVersion: row.active_version,
    lastError: row.last_error,
    state: normalizeState(row.state),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadWrProjects(
  admin: Admin,
  workspaceId: string
): Promise<WrProjectRow[]> {
  const { data, error } = await admin
    .from("wr_projects")
    .select(ROW_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as WrProjectDbRow[]).map(rowToWrProjectRow);
}

export async function getWrProjectRow(
  admin: Admin,
  workspaceId: string,
  projectId: string
): Promise<WrProjectRow | null> {
  const { data, error } = await admin
    .from("wr_projects")
    .select(ROW_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToWrProjectRow(data as WrProjectDbRow) : null;
}

/** Atomically increments the workspace's lifetime project counter only if it
 *  is still under `limit`. Returns false when the plan's limit is reached —
 *  the caller must not create the project in that case. */
export async function reserveWrProjectSlot(
  admin: Admin,
  workspaceId: string,
  limit: number
): Promise<boolean> {
  const { data, error } = await admin.rpc("wr_try_reserve_project_slot", {
    p_workspace_id: workspaceId,
    p_limit: limit,
  });
  if (error) throw error;
  return Boolean(data);
}

/** Compensating rollback for when a reserved slot's project insert fails. */
export async function releaseWrProjectSlot(admin: Admin, workspaceId: string): Promise<void> {
  const { error } = await admin.rpc("wr_release_project_slot", { p_workspace_id: workspaceId });
  if (error) {
    console.warn("[website-restructure] failed to release project slot:", error.message);
  }
}

export async function getWrProjectsCreatedTotal(admin: Admin, workspaceId: string): Promise<number> {
  const { data, error } = await admin
    .from("workspaces")
    .select("wr_projects_created_total")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as { wr_projects_created_total?: number } | null)?.wr_projects_created_total ?? 0;
}

export async function createWrProject(
  admin: Admin,
  input: { workspaceId: string; userId: string; name: string; provider: string }
): Promise<WrProjectRow> {
  const id = crypto.randomUUID();
  const { data, error } = await admin
    .from("wr_projects")
    .insert({
      id,
      workspace_id: input.workspaceId,
      created_by: input.userId,
      name: input.name.slice(0, 120),
      status: "active",
      provider: input.provider,
      phase: "collecting",
      state: EMPTY_WR_STATE,
    })
    .select(ROW_COLUMNS)
    .single();
  if (error) throw error;
  return rowToWrProjectRow(data as WrProjectDbRow);
}

export async function renameWrProject(
  admin: Admin,
  workspaceId: string,
  projectId: string,
  name: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("wr_projects")
    .update({ name: name.slice(0, 120) })
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function setWrProjectStatus(
  admin: Admin,
  workspaceId: string,
  projectId: string,
  status: "active" | "completed"
): Promise<boolean> {
  const { data, error } = await admin
    .from("wr_projects")
    .update({ status })
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function deleteWrProject(
  admin: Admin,
  workspaceId: string,
  projectId: string
): Promise<boolean> {
  await deleteWrProjectStorageFolder(admin, workspaceId, projectId);
  const { data, error } = await admin
    .from("wr_projects")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Full replace of the chat/images/logo/competitors slice — small enough
 *  (a handful of messages + refs, no binary data) to write in one shot on
 *  every turn, unlike Market Research's per-slice fingerprinting. */
export async function updateWrProjectState(
  admin: Admin,
  workspaceId: string,
  projectId: string,
  state: WrProjectState
): Promise<boolean> {
  const { data, error } = await admin
    .from("wr_projects")
    .update({ state })
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function setWrPhase(
  admin: Admin,
  workspaceId: string,
  projectId: string,
  phase: WrPhase,
  extra: { lastError?: string | null } = {}
): Promise<void> {
  const { error } = await admin
    .from("wr_projects")
    .update({ phase, ...(("lastError" in extra) ? { last_error: extra.lastError } : {}) })
    .eq("workspace_id", workspaceId)
    .eq("id", projectId);
  if (error) throw error;
}

const BUILD_LEASE_MS = 3 * 60 * 1000;

/**
 * Atomic compare-and-swap: only succeeds when no build is currently leased
 * (or the previous lease expired), so a double-click or a second tab cannot
 * start a concurrent generation on the same project.
 */
export async function tryLeaseWrProjectBuild(
  admin: Admin,
  workspaceId: string,
  projectId: string,
  userId?: string
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + BUILD_LEASE_MS).toISOString();
  let query = admin
    .from("wr_projects")
    .update({
      phase: "building",
      build_lease_until: leaseUntil,
      last_error: null,
      ...(userId ? { build_lease_by: userId } : {}),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", projectId);
  const leaseFilter = userId
    ? `build_lease_until.is.null,build_lease_until.lt.${nowIso},build_lease_by.eq.${userId}`
    : `build_lease_until.is.null,build_lease_until.lt.${nowIso}`;
  const { data, error } = await query.or(leaseFilter).select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function releaseWrProjectBuild(
  admin: Admin,
  workspaceId: string,
  projectId: string,
  result:
    | { ok: true; nextPhase: WrPhase; incrementEditMessages?: boolean; activeVersion?: number }
    | { ok: false; nextPhase: WrPhase; error: string }
): Promise<void> {
  if (result.ok) {
    const update: Record<string, unknown> = {
      phase: result.nextPhase,
      build_lease_until: null,
      build_lease_by: null,
      last_error: null,
    };
    if (typeof result.activeVersion === "number") update.active_version = result.activeVersion;
    if (result.incrementEditMessages) {
      const { data: row } = await admin
        .from("wr_projects")
        .select("edit_messages_used")
        .eq("workspace_id", workspaceId)
        .eq("id", projectId)
        .maybeSingle();
      const used = Math.min(WR_MAX_EDIT_MESSAGES, (row?.edit_messages_used ?? 0) + 1);
      update.edit_messages_used = used;
    }
    const { error } = await admin
      .from("wr_projects")
      .update(update)
      .eq("workspace_id", workspaceId)
      .eq("id", projectId);
    if (error) throw error;
    return;
  }
  const { error } = await admin
    .from("wr_projects")
    .update({
      phase: result.nextPhase,
      build_lease_until: null,
      build_lease_by: null,
      last_error: result.error.slice(0, 2000),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", projectId);
  if (error) throw error;
}
