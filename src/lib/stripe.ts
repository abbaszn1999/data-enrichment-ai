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

// ── Get the workspace owner's subscription (single source of truth) ──
export async function getOwnerSubscription(workspaceId: string) {
  const admin = createAdminClient();

  // Get workspace owner
  const { data: workspace } = await admin
    .from("workspaces")
    .select("owner_id")
    .eq("id", workspaceId)
    .single();

  if (!workspace) return null;

  // Get owner's subscription with plan
  const { data: sub } = await admin
    .from("user_subscriptions")
    .select("*, subscription_plans(*)")
    .eq("user_id", workspace.owner_id)
    .single();

  if (!sub) return null;

  return {
    subscription: sub,
    plan: sub.subscription_plans as any,
    ownerId: workspace.owner_id,
  };
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
