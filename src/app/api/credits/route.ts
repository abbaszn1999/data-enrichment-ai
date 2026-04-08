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

    // Get transactions first
    const { data: transactions, error: transactionsError } = await admin
      .from("credit_transactions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (transactionsError) {
      throw transactionsError;
    }

    // Get workspace members for filter dropdown
    const { data: members, error: membersError } = await admin
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId);

    if (membersError) {
      throw membersError;
    }

    const profileIds = Array.from(
      new Set([
        ...(transactions || []).map((tx: any) => tx.user_id).filter(Boolean),
        ...(members || []).map((m: any) => m.user_id).filter(Boolean),
      ])
    );

    let profilesById = new Map<string, string>();
    if (profileIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds);

      if (profilesError) {
        throw profilesError;
      }

      profilesById = new Map((profiles || []).map((profile: any) => [profile.id, profile.full_name || "Unknown"]));
    }

    return NextResponse.json({
      balance: {
        used: bal.used,
        total: bal.monthlyTotal + bal.bonusAvailable,
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
        user_name: tx.user_id ? profilesById.get(tx.user_id) || null : null,
      })),
      members: (members || []).map((m: any) => ({
        userId: m.user_id,
        role: m.role,
        fullName: profilesById.get(m.user_id) || "Unknown",
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
