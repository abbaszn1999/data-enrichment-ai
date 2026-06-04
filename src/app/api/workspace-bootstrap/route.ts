import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext, isContextSubscriptionActive } from "@/lib/workspace-context";

// Unified bootstrap endpoint for the dashboard layout. Returns workspace +
// role + credits + subscription + integration in ONE request, collapsing the
// previous 4-level client fetch waterfall into a single round-trip. Server-side
// this is cheap: getWorkspaceContext resolves everything via a single cached RPC.

let _plansCache: { data: any[] | null; ts: number } = { data: null, ts: 0 };
let _packsCache: { data: any[] | null; ts: number } = { data: null, ts: 0 };
const REF_CACHE_TTL = 10 * 60 * 1000;

async function getCachedPlans() {
  if (_plansCache.data && Date.now() - _plansCache.ts < REF_CACHE_TTL) return _plansCache.data;
  const admin = createAdminClient();
  const { data } = await admin
    .from("subscription_plans").select("*").eq("is_active", true)
    .order("sort_order", { ascending: true });
  _plansCache = { data: data || [], ts: Date.now() };
  return _plansCache.data;
}

async function getCachedPacks() {
  if (_packsCache.data && Date.now() - _packsCache.ts < REF_CACHE_TTL) return _packsCache.data;
  const admin = createAdminClient();
  const { data } = await admin
    .from("credit_packs").select("*").eq("is_active", true)
    .order("sort_order", { ascending: true });
  _packsCache = { data: data || [], ts: Date.now() };
  return _packsCache.data;
}

export async function GET(request: NextRequest) {
  try {
    const slug = new URL(request.url).searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: workspace, error: wsErr } = await admin
      .from("workspaces").select("*").eq("slug", slug).single();
    if (wsErr || !workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const [ctx, plans, packs] = await Promise.all([
      getWorkspaceContext({ workspaceId: workspace.id, userId: session.user.id }),
      getCachedPlans(),
      getCachedPacks(),
    ]);

    if (!ctx.membershipRole) {
      return NextResponse.json({ workspace, role: null, error: "Not a member" }, { status: 200 });
    }

    const bal = ctx.credits;
    const sub = ctx.subscription;

    return NextResponse.json({
      workspace,
      role: ctx.membershipRole,
      hasIntegration: !!ctx.integration,
      integration: ctx.integration ?? null,
      credits: {
        used: bal.used,
        total: bal.monthlyTotal + bal.bonusAvailable,
        bonus: bal.bonus,
        remaining: bal.total,
      },
      subscription: {
        subscription: sub ? {
          id: sub.id,
          status: sub.status,
          billingCycle: sub.billing_cycle,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          currentPeriodEnd: sub.current_period_end,
          stripeCustomerId: sub.stripe_customer_id,
          stripeSubscriptionId: sub.stripe_subscription_id,
        } : null,
        currentPlan: ctx.plan || null,
        availablePlans: plans || [],
        creditPacks: packs || [],
        credits: bal,
        isActive: isContextSubscriptionActive(ctx),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}
