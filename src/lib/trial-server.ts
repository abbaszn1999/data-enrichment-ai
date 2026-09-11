import { createAdminClient } from "@/lib/supabase-admin";
import { invalidateSubscriptionCache } from "@/lib/stripe";
import { clearWorkspaceContextCache } from "@/lib/workspace-context";
import { isEligibleForTrial, TRIAL_DAYS, TRIAL_PLAN_NAME } from "@/lib/trial";

export async function expireElapsedTrials(): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("expire_elapsed_trials");
  if (error) {
    console.error("[trial] expire_elapsed_trials failed:", error.message);
    return 0;
  }
  const n = typeof data === "number" ? data : Number(data ?? 0);
  if (n > 0) {
    invalidateSubscriptionCache();
    clearWorkspaceContextCache();
  }
  return Number.isFinite(n) ? n : 0;
}

/** Grant a one-time in-app trial to a workspace owner who has never paid. */
export async function ensureOwnerTrial(userId: string): Promise<{ granted: boolean }> {
  await expireElapsedTrials();

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("user_subscriptions")
    .select("id, has_used_trial, stripe_subscription_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) {
    throw new Error(existingError.message);
  }
  if (!isEligibleForTrial(existing)) {
    return { granted: false };
  }

  const { data: trialPlan, error: planError } = await admin
    .from("subscription_plans")
    .select("id")
    .eq("name", TRIAL_PLAN_NAME)
    .single();
  if (planError || !trialPlan) {
    throw new Error(planError?.message || "Trial plan is not configured");
  }

  const now = new Date();
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  const payload = {
    user_id: userId,
    plan_id: trialPlan.id,
    billing_cycle: "monthly" as const,
    status: "trialing" as const,
    trial_end: trialEnd.toISOString(),
    current_period_start: now.toISOString(),
    current_period_end: trialEnd.toISOString(),
    credits_used: 0,
    bonus_credits: 0,
    has_used_trial: true,
    cancel_at_period_end: false,
    credits_reset_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const { error: insertError } = await admin.from("user_subscriptions").insert(payload);
  if (insertError) {
    if (insertError.code === "23505") return { granted: false };
    throw new Error(insertError.message);
  }

  invalidateSubscriptionCache();
  return { granted: true };
}
