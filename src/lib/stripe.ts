import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import { roundCredits } from "@/lib/format-credits";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-03-31.basil" as any,
      typescript: true,
    });
  }
  return _stripe;
}

// Lazy proxy: `stripe` can be imported at module level without crashing at build time
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop];
  },
});

// ── Get or create Stripe customer for a user ──
export async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const admin = createAdminClient();

  // Check if user already has a stripe_customer_id
  const { data: sub } = await admin
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single();

  if (sub?.stripe_customer_id) {
    return sub.stripe_customer_id;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId },
  });

  return customer.id;
}

// In-memory caches to avoid redundant DB round-trips
const _ownerCache = new Map<string, { ownerId: string; ts: number }>();
const _subCache = new Map<string, { result: any; ts: number }>();
const OWNER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SUB_CACHE_TTL = 60 * 1000; // 60 seconds

// Call this after credit deductions or subscription changes to force fresh data
export function invalidateSubscriptionCache(workspaceId?: string) {
  if (workspaceId) {
    _subCache.delete(workspaceId);
  } else {
    _subCache.clear();
  }
}

// ── Get the workspace owner's subscription (single source of truth) ──
export async function getOwnerSubscription(workspaceId: string) {
  // Check full subscription cache first
  const subCached = _subCache.get(workspaceId);
  if (subCached && Date.now() - subCached.ts < SUB_CACHE_TTL) {
    return subCached.result;
  }

  const admin = createAdminClient();

  // Check owner cache to skip a DB round-trip
  let ownerId: string | null = null;
  const ownerCached = _ownerCache.get(workspaceId);
  if (ownerCached && Date.now() - ownerCached.ts < OWNER_CACHE_TTL) {
    ownerId = ownerCached.ownerId;
  } else {
    const { data: workspace } = await admin
      .from("workspaces")
      .select("owner_id")
      .eq("id", workspaceId)
      .single();

    if (!workspace) return null;
    ownerId = workspace.owner_id;
    _ownerCache.set(workspaceId, { ownerId: ownerId!, ts: Date.now() });
  }

  // Get owner's subscription with plan
  const { data: sub } = await admin
    .from("user_subscriptions")
    .select("*, subscription_plans(*)")
    .eq("user_id", ownerId)
    .single();

  if (!sub) {
    _subCache.set(workspaceId, { result: null, ts: Date.now() });
    return null;
  }

  const result = {
    subscription: sub,
    plan: sub.subscription_plans as any,
    ownerId,
  };
  _subCache.set(workspaceId, { result, ts: Date.now() });
  return result;
}

// ── Get user's own subscription ──
export async function getUserSubscription(userId: string) {
  const admin = createAdminClient();

  const { data: sub } = await admin
    .from("user_subscriptions")
    .select("*, subscription_plans(*)")
    .eq("user_id", userId)
    .single();

  if (!sub) return null;

  return {
    subscription: sub,
    plan: sub.subscription_plans as any,
  };
}

// ── Check if subscription is active ──
export function isSubscriptionActive(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

// ── Calculate credit balance ──
export function calculateCreditBalance(sub: {
  status?: string | null;
  billing_cycle?: string | null;
  credits_used: number;
  bonus_credits: number;
  subscription_plans?: { monthly_ai_credits: number } | null;
} | null) {
  if (!sub) {
    return {
      monthlyRemaining: 0,
      bonus: 0,
      bonusAvailable: 0,
      bonusLocked: 0,
      total: 0,
      used: 0,
      monthlyTotal: 0,
      canUseCredits: false,
    };
  }

  const canUseCredits = isSubscriptionActive(sub.status);
  const planCredits = roundCredits((sub.subscription_plans as any)?.monthly_ai_credits ?? 0);
  const monthlyTotal = sub.billing_cycle === "yearly"
    ? roundCredits(planCredits * 12)
    : planCredits;
  const monthlyRemaining = canUseCredits
    ? roundCredits(Math.max(0, monthlyTotal - sub.credits_used))
    : 0;
  const bonus = roundCredits(sub.bonus_credits ?? 0);
  const bonusAvailable = canUseCredits ? bonus : 0;
  const bonusLocked = canUseCredits ? 0 : bonus;

  return {
    monthlyTotal,
    monthlyRemaining,
    bonus,
    bonusAvailable,
    bonusLocked,
    total: roundCredits(monthlyRemaining + bonusAvailable),
    used: roundCredits(sub.credits_used),
    canUseCredits,
  };
}

// ── Find plan by Stripe price ID ──
export async function findPlanByStripePriceId(priceId: string) {
  const admin = createAdminClient();

  const { data: plan } = await admin
    .from("subscription_plans")
    .select("*")
    .or(`stripe_price_monthly_id.eq.${priceId},stripe_price_yearly_id.eq.${priceId}`)
    .single();

  return plan;
}
