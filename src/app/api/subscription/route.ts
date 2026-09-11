import { NextResponse } from "next/server";
import {
  getOwnerSubscription,
  getActiveSubscriptionPlans,
  isSubscriptionActive,
  calculateCreditBalance,
} from "@/lib/stripe";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const [ownerSub, plans] = await Promise.all([
      getOwnerSubscription(workspaceId),
      getActiveSubscriptionPlans(),
    ]);

    const sub = ownerSub?.subscription ?? null;
    const bal = calculateCreditBalance(sub);

    return NextResponse.json({
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
      currentPlan: ownerSub?.plan || null,
      availablePlans: plans || [],
      credits: bal,
      isActive: sub ? isSubscriptionActive(sub.status, sub.trial_end) : false,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
