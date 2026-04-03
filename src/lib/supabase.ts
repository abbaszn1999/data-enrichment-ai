import { createClient } from "@/lib/supabase-browser";
import type { Role } from "@/lib/permissions";

// Re-export a convenience singleton for client-side use
function getClient() {
  return createClient();
}

// ─── Types ───────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo_url: string | null;
  cms_type: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  profiles?: { full_name: string; avatar_url: string | null };
  email?: string | null;
}

export interface Category {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string;
  parent_id: string | null;
  sort_order: number;
  attributes: any[];
  created_at: string;
}

export interface MasterProduct {
  id: string;
  workspace_id: string;
  sku: string;
  category_id: string | null;
  data: Record<string, any>;
  enriched_data: Record<string, any>;
  status: string;
  source_file_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportSession {
  id: string;
  workspace_id: string;
  name: string;
  notes: string;
  status: string;
  supplier_match_column: string | null;
  master_match_column: string;
  target_category_ids: string[];
  matching_rules: any[];
  total_rows: number;
  existing_count: number;
  new_count: number;
  enriched_count: number;
  storage_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ImportRow {
  id: string;
  session_id: string;
  row_index: number;
  match_type: "existing" | "new" | "ambiguous";
  matched_product_id: string | null;
  confidence: number;
  supplier_data: Record<string, any>;
  mapped_data: Record<string, any>;
  diff_data: Record<string, any>;
  enriched_data: Record<string, any>;
  action: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

// ─── Profiles ────────────────────────────────────────────

export async function getProfile(userId: string) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId: string, updates: { full_name?: string; avatar_url?: string }) {
  const supabase = getClient();
  const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
  if (error) throw error;
}

// ─── Workspaces CRUD ─────────────────────────────────────

export interface WorkspaceWithRole extends Workspace {
  memberRole?: string;
}

export async function getWorkspaces(): Promise<WorkspaceWithRole[]> {
  const supabase = getClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(*)")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data ?? [])
    .filter((m: any) => m.workspaces)
    .map((m: any) => ({ ...m.workspaces, memberRole: m.role }));
}

export async function getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function createWorkspace(workspace: {
  name: string;
  slug: string;
  description?: string;
  cms_type?: string;
}): Promise<Workspace> {
  // Use server-side API route with admin client to bypass RLS
  const res = await fetch("/api/workspaces/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workspace),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create workspace");

  return data as Workspace;
}

export async function updateWorkspace(id: string, updates: Partial<Pick<Workspace, "name" | "description" | "cms_type" | "logo_url">>) {
  const supabase = getClient();
  const { error } = await supabase.from("workspaces").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteWorkspace(id: string) {
  const res = await fetch("/api/workspaces/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: id }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete workspace");
}

// ─── Workspace Members ───────────────────────────────────

export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const res = await fetch(`/api/team/members?workspaceId=${encodeURIComponent(workspaceId)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to load members");
  return json.members ?? [];
}

export async function getCurrentMemberRole(workspaceId: string): Promise<Role | null> {
  const supabase = getClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();
  if (error) return null;
  return data?.role as Role;
}

export async function updateMemberRole(memberId: string, role: Role) {
  const res = await fetch("/api/team/members", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId, role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update role");
}

export async function removeMember(memberId: string) {
  const res = await fetch("/api/team/members", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to remove member");
}

// ─── Workspace Invites ───────────────────────────────────

export async function getWorkspaceInvites(workspaceId: string) {
  const supabase = getClient();
  // Try filtering by accepted_at first; fall back to fetching all if column doesn't exist
  let { data, error } = await supabase
    .from("workspace_invites")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    // Fallback: column may not exist yet, fetch all invites
    const res = await supabase
      .from("workspace_invites")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (res.error) throw res.error;
    data = res.data;
  }
  return data ?? [];
}

export async function createInvite(workspaceId: string, email: string, role: Role) {
  const supabase = getClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("workspace_invites")
    .insert({ workspace_id: workspaceId, email, role, invited_by: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelInvite(inviteId: string) {
  const supabase = getClient();
  const { error } = await supabase.from("workspace_invites").delete().eq("id", inviteId);
  if (error) throw error;
}

export async function acceptInvite(inviteId: string) {
  const supabase = getClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error("Not authenticated");

  const { data: invite, error: fetchError } = await supabase
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .single();
  if (fetchError) throw fetchError;

  // Add member
  await supabase.from("workspace_members").insert({
    workspace_id: invite.workspace_id,
    user_id: user.id,
    role: invite.role,
  });

  // Mark invite accepted (set accepted_at + status if columns exist, otherwise delete the invite)
  const { error: updateErr } = await supabase
    .from("workspace_invites")
    .update({ accepted_at: new Date().toISOString(), status: "accepted" })
    .eq("id", inviteId);
  if (updateErr) {
    // Fallback: delete the invite if accepted_at column doesn't exist
    await supabase.from("workspace_invites").delete().eq("id", inviteId);
  }
}

// ─── Categories, Products, Suppliers ─────────────────────
// NOTE: These are now stored as JSON files in Supabase Storage.
// See src/lib/storage-helpers.ts for the new CRUD functions.

// ─── Import Sessions CRUD ────────────────────────────────

export async function getImportSessions(workspaceId: string, opts?: { status?: string; search?: string }) {
  const supabase = getClient();
  let query = supabase
    .from("import_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.search) query = query.or(`name.ilike.%${opts.search}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getImportSession(id: string): Promise<ImportSession | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("import_sessions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function createImportSession(workspaceId: string, importSession: {
  name: string;
  notes?: string;
  total_rows: number;
}) {
  const supabase = getClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("import_sessions")
    .insert({ workspace_id: workspaceId, created_by: user.id, ...importSession })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateImportSession(id: string, updates: Partial<ImportSession>) {
  const supabase = getClient();
  const { error } = await supabase.from("import_sessions").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteImportSession(id: string) {
  const supabase = getClient();

  // 1. Get session to find workspace_id for Storage cleanup
  const { data: session } = await supabase
    .from("import_sessions")
    .select("workspace_id")
    .eq("id", id)
    .single();

  if (session?.workspace_id) {
    // Delete project JSON from Storage
    const projectPath = `${session.workspace_id}/projects/${id}.json`;
    await supabase.storage.from("workspace-files").remove([projectPath]).catch(() => {});
  }

  // 2. Delete session from DB
  const { error } = await supabase.from("import_sessions").delete().eq("id", id);
  if (error) throw error;
}

// ─── Import Rows ─────────────────────────────────────────
// NOTE: Import rows are now stored as JSON files in Supabase Storage.
// See src/lib/storage-helpers.ts for the new CRUD functions.

// ─── Uploaded Files ──────────────────────────────────────
// NOTE: File metadata is no longer tracked in DB. Files go directly to Storage.

// ─── Activity Log ────────────────────────────────────────

export async function logActivity(workspaceId: string, action: string, details?: { entity_type?: string; entity_id?: string; details?: any }) {
  const supabase = getClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  await supabase.from("activity_log").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    action,
    entity_type: details?.entity_type,
    entity_id: details?.entity_id,
    details: details?.details ?? {},
  });
}

export async function getActivityLog(workspaceId: string, limit = 20) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("*, profiles(full_name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ─── Subscriptions & Credits ─────────────────────────────

export async function getWorkspaceSubscription(workspaceId: string) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("workspace_subscriptions")
    .select("*, subscription_plans(*)")
    .eq("workspace_id", workspaceId)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function getSubscriptionPlans() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getCreditBalance(workspaceId: string) {
  const sub = await getWorkspaceSubscription(workspaceId);
  if (!sub) return { used: 0, total: 0, remaining: 0 };
  const total = sub.subscription_plans?.monthly_ai_credits ?? 0;
  const used = sub.credits_used ?? 0;
  return { used, total, remaining: Math.max(0, total - used) };
}

export async function deductCredits(workspaceId: string, amount: number, operation: string, entityType?: string, entityId?: string) {
  const supabase = getClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error("Not authenticated");

  // Log transaction
  await supabase.from("credit_transactions").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    operation,
    credits_used: amount,
    entity_type: entityType,
    entity_id: entityId,
  });

  // Increment used count
  const { data: sub } = await supabase
    .from("workspace_subscriptions")
    .select("credits_used")
    .eq("workspace_id", workspaceId)
    .single();

  if (sub) {
    await supabase
      .from("workspace_subscriptions")
      .update({ credits_used: (sub.credits_used ?? 0) + amount })
      .eq("workspace_id", workspaceId);
  }
}

export async function getCreditTransactions(workspaceId: string, limit = 50) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ─── Export Templates ────────────────────────────────────

export async function getExportTemplates(workspaceId?: string) {
  const supabase = getClient();
  let query = supabase.from("export_templates").select("*");
  if (workspaceId) {
    query = query.or(`is_system.eq.true,workspace_id.eq.${workspaceId}`);
  } else {
    query = query.eq("is_system", true);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
