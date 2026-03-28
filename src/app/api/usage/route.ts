import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const supabase = await createClient();

    // Get subscription with plan
    const { data: sub } = await supabase
      .from("workspace_subscriptions")
      .select("*, subscription_plans(*)")
      .eq("workspace_id", workspaceId)
      .single();

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

    const plan = sub?.subscription_plans;
    const monthlyCredits = plan?.monthly_ai_credits ?? 0;
    const creditsUsed = sub?.credits_used ?? 0;

    return NextResponse.json({
      plan: {
        name: plan?.display_name || "No Plan",
        monthlyCredits,
        priceMonthly: plan?.price_monthly || 0,
      },
      credits: {
        used: creditsUsed,
        total: monthlyCredits,
        remaining: Math.max(0, monthlyCredits - creditsUsed),
        resetsAt: sub?.credits_reset_at,
      },
      breakdown,
      totalAllTime: totalUsed,
      totalTransactions: (transactions || []).length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
