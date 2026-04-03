import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOwnerSubscription, isSubscriptionActive, calculateCreditBalance } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const admin = createAdminClient();

    // Get owner's subscription (per-user model)
    const ownerSub = await getOwnerSubscription(workspaceId);

    // Get all available plans
    const { data: plans } = await admin
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    // Get credit packs
    const { data: packs } = await admin
      .from("credit_packs")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    const sub = ownerSub?.subscription ?? null;
    const bal = calculateCreditBalance(sub);

    return NextResponse.json({
      subscription: sub ? {
        id: sub.id,
        status: sub.status,
        billingCycle: sub.billing_cycle,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: sub.current_period_end,
        stripeCustomerId: sub.stripe_customer_id,
        stripeSubscriptionId: sub.stripe_subscription_id,
      } : null,
      currentPlan: ownerSub?.plan || null,
      availablePlans: plans || [],
      creditPacks: packs || [],
      credits: bal,
      isActive: sub ? isSubscriptionActive(sub.status) : false,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
