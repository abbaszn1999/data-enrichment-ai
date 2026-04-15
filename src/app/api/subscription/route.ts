import { NextResponse } from "next/server";
import { getOwnerSubscription, isSubscriptionActive, calculateCreditBalance } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";

// Cache reference data (plans + packs) — they almost never change
let _plansCache: { data: any[] | null; ts: number } = { data: null, ts: 0 };
let _packsCache: { data: any[] | null; ts: number } = { data: null, ts: 0 };
const REF_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getCachedPlans() {
  if (_plansCache.data && Date.now() - _plansCache.ts < REF_CACHE_TTL) return _plansCache.data;
  const admin = createAdminClient();
  const { data } = await admin.from("subscription_plans").select("*").eq("is_active", true).order("sort_order", { ascending: true });
  _plansCache = { data: data || [], ts: Date.now() };
  return _plansCache.data;
}

async function getCachedPacks() {
  if (_packsCache.data && Date.now() - _packsCache.ts < REF_CACHE_TTL) return _packsCache.data;
  const admin = createAdminClient();
  const { data } = await admin.from("credit_packs").select("*").eq("is_active", true).order("sort_order", { ascending: true });
  _packsCache = { data: data || [], ts: Date.now() };
  return _packsCache.data;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Run all 3 in parallel — each one uses its own cache
    const [ownerSub, plans, packs] = await Promise.all([
      getOwnerSubscription(workspaceId),
      getCachedPlans(),
      getCachedPacks(),
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
