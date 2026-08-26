import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

/**
 * Wallet top-ups need a Stripe customer per user, but must work for users
 * who have never bought a subscription — so this is backed by its own
 * `wallet_stripe_customers` table rather than `user_subscriptions`
 * (see the migration for why). Mirrors `getOrCreateStripeCustomer` in
 * `src/lib/stripe.ts`, just with a mapping table the wallet owns.
 */
export async function getOrCreateWalletStripeCustomer(
  admin: SupabaseClient,
  userId: string,
  email: string
): Promise<string> {
  const { data: existing } = await admin
    .from("wallet_stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId, source: "wallet" },
  });

  const { error } = await admin
    .from("wallet_stripe_customers")
    .upsert({ user_id: userId, stripe_customer_id: customer.id }, { onConflict: "user_id" });
  if (error) {
    // The customer was created either way; a failed cache write just means
    // the next top-up creates a second Stripe customer instead of reusing
    // this one — not worth failing the checkout over.
    console.error("[wallet] failed to cache Stripe customer id:", error.message);
  }

  return customer.id;
}
