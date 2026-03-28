import { createClient } from "@/lib/supabase-browser";
import { loadProductsJson } from "@/lib/storage-helpers";

export interface PlanLimits {
  maxWorkspaces: number | null;
  maxMembers: number | null;
  maxProducts: number | null;
  maxImports: number | null;
  maxStorage: number | null;
  monthlyCredits: number;
}

export async function getPlan(workspaceId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("workspace_subscriptions")
    .select("*, subscription_plans(*)")
    .eq("workspace_id", workspaceId)
    .single();

  return data?.subscription_plans || null;
}

export async function getSubscription(workspaceId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("workspace_subscriptions")
    .select("*, subscription_plans(*)")
    .eq("workspace_id", workspaceId)
    .single();

  return data;
}

export async function getPlanLimits(workspaceId: string): Promise<PlanLimits> {
  const plan = await getPlan(workspaceId);
  if (!plan) {
    return { maxWorkspaces: 1, maxMembers: 1, maxProducts: 100, maxImports: 5, maxStorage: null, monthlyCredits: 0 };
  }
  return {
    maxWorkspaces: plan.max_workspaces,
    maxMembers: plan.max_members_per_workspace,
    maxProducts: plan.max_products_per_workspace,
    maxImports: plan.max_imports_per_month,
    maxStorage: plan.max_storage_bytes,
    monthlyCredits: plan.monthly_ai_credits,
  };
}

export async function checkLimit(workspaceId: string, resource: "members" | "products" | "imports"): Promise<{ allowed: boolean; current: number; limit: number | null }> {
  const supabase = createClient();
  const limits = await getPlanLimits(workspaceId);

  let current = 0;
  let limit: number | null = null;

  switch (resource) {
    case "members": {
      const { count } = await supabase
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      current = count ?? 0;
      limit = limits.maxMembers;
      break;
    }
    case "products": {
      // Products are stored in Storage (products.json), not in a DB table
      const products = await loadProductsJson(workspaceId);
      current = products.length;
      limit = limits.maxProducts;
      break;
    }
    case "imports": {
      const { count } = await supabase
        .from("import_sessions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      current = count ?? 0;
      limit = limits.maxImports;
      break;
    }
  }

  const allowed = limit === null || current < limit;
  return { allowed, current, limit };
}

export async function canPerformAction(workspaceId: string, action: "create_import" | "add_member" | "add_product"): Promise<boolean> {
  switch (action) {
    case "create_import":
      return (await checkLimit(workspaceId, "imports")).allowed;
    case "add_member":
      return (await checkLimit(workspaceId, "members")).allowed;
    case "add_product":
      return (await checkLimit(workspaceId, "products")).allowed;
    default:
      return true;
  }
}
