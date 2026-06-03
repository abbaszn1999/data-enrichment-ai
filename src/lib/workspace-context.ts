import { createAdminClient } from "@/lib/supabase-admin";
import { calculateCreditBalance, isSubscriptionActive } from "@/lib/stripe";
import type { IntegrationRecord } from "@/lib/sync/core/types";

export type WorkspaceContext = {
  membershipRole: string | null;
  subscription: any | null;
  plan: any | null;
  credits: ReturnType<typeof calculateCreditBalance>;
  integration: IntegrationRecord | null;
  ownerId: string | null;
  source: "cache" | "rpc" | "fallback";
  durationMs: number;
};

const CACHE_TTL_MS = 30_000; // 30s, tuned for hot paths
const cache = new Map<string, { ctx: WorkspaceContext; ts: number }>();

function cacheKey(workspaceId: string, userId: string) {
  return `${workspaceId}:${userId}`;
}

export function clearWorkspaceContextCache(workspaceId?: string) {
  if (!workspaceId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      cache.delete(key);
    }
  }
}

export function updateCachedCredits(workspaceId: string, remaining: number) {
  for (const [key, entry] of cache.entries()) {
    if (key.startsWith(`${workspaceId}:`)) {
      const credits = entry.ctx.credits;
      const monthlyRemaining = Math.max(
        0,
        Math.min(credits.monthlyRemaining ?? 0, remaining)
      );
      const bonusAvailable = Math.max(0, remaining - monthlyRemaining);
      cache.set(key, {
        ...entry,
        ctx: {
          ...entry.ctx,
          credits: {
            ...credits,
            total: Math.max(0, remaining),
            monthlyRemaining,
            bonusAvailable,
          },
        },
      });
    }
  }
}

function buildCredits(subscription: any | null) {
  try {
    return calculateCreditBalance(subscription);
  } catch (err) {
    console.warn("[workspace-context] credit calc failed", err);
    return calculateCreditBalance(null);
  }
}

async function fetchViaRpc(workspaceId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_workspace_context_v1", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  if (error) throw error;
  if (!data) return null;
  
  const row = Array.isArray(data) ? data[0] : (data as any);
  if (!row) return null;

  const subscription = row.subscription ?? null;
  const plan = row.plan ?? null;
  
  if (subscription && plan) {
    subscription.subscription_plans = plan;
  }

  const integration = row.integration ?? null;
  const membershipRole = row.membership_role ?? null;
  const ownerId = row.owner_id ?? null;
  const credits = buildCredits(subscription);
  return { subscription, plan, integration, membershipRole, ownerId, credits };
}

async function fetchViaFallback(workspaceId: string, userId: string) {
  const admin = createAdminClient();

  // Membership
  const { data: member } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  const membershipRole = member?.role ?? null;

  // Owner
  const { data: workspace } = await admin
    .from("workspaces")
    .select("owner_id")
    .eq("id", workspaceId)
    .maybeSingle();
  const ownerId = (workspace as any)?.owner_id ?? null;

  // Subscription + plan (per-user model)
  let subscription: any = null;
  let plan: any = null;
  if (ownerId) {
    const { data: sub } = await admin
      .from("user_subscriptions")
      .select("*, subscription_plans(*)")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (sub) {
      subscription = sub;
      plan = (sub as any)?.subscription_plans ?? null;
    }
  }

  // Integration
  const { data: integration } = await admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const credits = buildCredits(subscription);

  return {
    subscription,
    plan,
    integration: integration ? (integration as IntegrationRecord) : null,
    membershipRole,
    ownerId,
    credits,
  };
}

export async function getWorkspaceContext(params: {
  workspaceId: string;
  userId: string;
  forceRefresh?: boolean;
}): Promise<WorkspaceContext> {
  const { workspaceId, userId, forceRefresh } = params;
  const key = cacheKey(workspaceId, userId);
  const now = Date.now();

  if (!forceRefresh) {
    const cached = cache.get(key);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return { ...cached.ctx, source: "cache", durationMs: 0 };
    }
  }

  const start = Date.now();
  let ctx: WorkspaceContext | null = null;

  try {
    const rpc = await fetchViaRpc(workspaceId, userId);
    if (rpc) {
      ctx = {
        membershipRole: rpc.membershipRole,
        subscription: rpc.subscription,
        plan: rpc.plan,
        integration: rpc.integration ?? null,
        credits: rpc.credits,
        ownerId: rpc.ownerId ?? null,
        source: "rpc",
        durationMs: 0,
      };
    }
  } catch (err) {
    console.warn("[workspace-context] rpc failed, falling back", err);
  }

  if (!ctx) {
    const fb = await fetchViaFallback(workspaceId, userId);
    ctx = {
      membershipRole: fb.membershipRole,
      subscription: fb.subscription,
      plan: fb.plan,
      integration: fb.integration,
      credits: fb.credits,
      ownerId: fb.ownerId,
      source: "fallback",
      durationMs: 0,
    };
  }

  const durationMs = Date.now() - start;
  const finalCtx: WorkspaceContext = { ...ctx, durationMs };

  cache.set(key, { ctx: finalCtx, ts: now });
  return finalCtx;
}

export function isContextSubscriptionActive(ctx: WorkspaceContext) {
  return !!ctx.subscription && isSubscriptionActive(ctx.subscription.status);
}
