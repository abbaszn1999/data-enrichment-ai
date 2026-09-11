import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext, isContextSubscriptionActive, clearWorkspaceContextCache } from "@/lib/workspace-context";
import { getActiveSubscriptionPlans, invalidateSubscriptionCache } from "@/lib/stripe";
import { ensureOwnerTrial } from "@/lib/trial-server";

// Unified bootstrap endpoint for the dashboard layout. Returns workspace +
// role + credits + subscription + integration in ONE request, collapsing the
// previous 4-level client fetch waterfall into a single round-trip. Server-side
// this is cheap: getWorkspaceContext resolves everything via a single cached RPC.

export async function GET(request: NextRequest) {
  try {
    const slug = new URL(request.url).searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: workspace, error: wsErr } = await admin
      .from("workspaces").select("*").eq("slug", slug).single();
    if (wsErr || !workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const isOwner = user.id === workspace.owner_id;
    if (isOwner) {
      try {
        await ensureOwnerTrial(user.id);
      } catch (err) {
        console.error("[trial] ensureOwnerTrial failed", err);
      }
      clearWorkspaceContextCache(workspace.id);
      invalidateSubscriptionCache(workspace.id);
    }

    const [ctx, plans] = await Promise.all([
      getWorkspaceContext({
        workspaceId: workspace.id,
        userId: user.id,
        forceRefresh: isOwner,
      }),
      getActiveSubscriptionPlans(),
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
          trialEnd: sub.trial_end ?? null,
          stripeCustomerId: sub.stripe_customer_id,
          stripeSubscriptionId: sub.stripe_subscription_id,
        } : null,
        currentPlan: ctx.plan || null,
        availablePlans: plans || [],
        credits: bal,
        isActive: isContextSubscriptionActive(ctx),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
