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

    // Get credit transactions summary
    const { data: transactions } = await supabase
      .from("credit_transactions")
      .select("operation, credits_used")
      .eq("workspace_id", workspaceId);

    // Breakdown by operation
    const breakdown: Record<string, number> = {};
    let totalUsed = 0;
    for (const tx of transactions || []) {
      if (tx.credits_used > 0) {
        breakdown[tx.operation] = (breakdown[tx.operation] || 0) + tx.credits_used;
        totalUsed += tx.credits_used;
      }
    }

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
      breakdown,
      totalAllTime: totalUsed,
      totalTransactions: (transactions || []).length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
