import type { SupabaseClient } from "@supabase/supabase-js";

/** Stamp first paid activation once. Never overwrites an existing first_paid_at. */
export async function stampFirstPaidAtIfNull(
  admin: SupabaseClient,
  lookup: { userId: string } | { stripeSubscriptionId: string }
): Promise<void> {
  const now = new Date().toISOString();
  let query = admin
    .from("user_subscriptions")
    .update({ first_paid_at: now, updated_at: now })
    .is("first_paid_at", null)
    .eq("status", "active")
    .not("stripe_subscription_id", "is", null);

  query =
    "userId" in lookup
      ? query.eq("user_id", lookup.userId)
      : query.eq("stripe_subscription_id", lookup.stripeSubscriptionId);

  const { error } = await query;
  if (error) {
    console.error("[welcome-gift] stamp first_paid_at failed", error.message);
  }
}
