import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getOwnerSubscription, calculateCreditBalance, isSubscriptionActive } from "@/lib/stripe";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Get owner's subscription (per-user model)
    const ownerSub = await getOwnerSubscription(workspaceId);
    const bal = calculateCreditBalance(ownerSub?.subscription ?? null);
    const plan = ownerSub?.plan;

    // Get transactions with user profile names
    const { data: transactions } = await admin
      .from("credit_transactions")
      .select("*, profiles!credit_transactions_user_id_fkey(full_name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Get workspace members for filter dropdown
    const { data: members } = await admin
      .from("workspace_members")
      .select("user_id, role, profiles!workspace_members_user_id_fkey(full_name)")
      .eq("workspace_id", workspaceId);

    return NextResponse.json({
      balance: {
        used: bal.used,
        total: bal.monthlyTotal,
        bonus: bal.bonus,
        remaining: bal.total,
        resetsAt: ownerSub?.subscription?.credits_reset_at,
      },
      plan: plan ? {
        displayName: plan.display_name,
        monthlyCredits: plan.monthly_ai_credits,
        priceMonthly: plan.price_monthly,
        priceYearly: plan.price_yearly,
      } : null,
      subscription: ownerSub?.subscription ? {
        status: ownerSub.subscription.status,
        isActive: isSubscriptionActive(ownerSub.subscription.status),
        billingCycle: ownerSub.subscription.billing_cycle,
        cancelAtPeriodEnd: ownerSub.subscription.cancel_at_period_end,
        currentPeriodEnd: ownerSub.subscription.current_period_end,
      } : null,
      transactions: (transactions || []).map((tx: any) => ({
        ...tx,
        user_name: tx.profiles?.full_name || null,
      })),
      members: (members || []).map((m: any) => ({
        userId: m.user_id,
        role: m.role,
        fullName: (m.profiles as any)?.full_name || "Unknown",
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
