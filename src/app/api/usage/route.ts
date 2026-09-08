import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOwnerSubscription, calculateCreditBalance } from "@/lib/stripe";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Get owner's subscription (per-user model)
    const ownerSub = await getOwnerSubscription(workspaceId);
    const bal = calculateCreditBalance(ownerSub?.subscription ?? null);
    const plan = ownerSub?.plan;

    const supabase = await createClient();
    const { data: totals } = await supabase.rpc("credit_usage_totals", {
      p_workspace_id: workspaceId,
    });
    const parsed =
      totals && typeof totals === "object"
        ? (totals as { total_used?: number; total_count?: number })
        : {};

    return NextResponse.json({
      plan: {
        name: plan?.display_name || "No Plan",
        monthlyCredits: bal.monthlyTotal,
        priceMonthly: plan?.price_monthly || 0,
      },
      credits: {
        used: bal.used,
        total: bal.monthlyTotal + bal.bonusAvailable,
        bonus: bal.bonus,
        remaining: bal.total,
        resetsAt: ownerSub?.subscription?.credits_reset_at,
      },
      subscription: ownerSub?.subscription ? {
        status: ownerSub.subscription.status,
        billingCycle: ownerSub.subscription.billing_cycle,
        cancelAtPeriodEnd: ownerSub.subscription.cancel_at_period_end,
        currentPeriodEnd: ownerSub.subscription.current_period_end,
      } : null,
      breakdown: {},
      totalAllTime: Number(parsed.total_used ?? 0),
      totalTransactions: Number(parsed.total_count ?? 0),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
