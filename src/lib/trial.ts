export const TRIAL_DAYS = 14;
export const TRIAL_CREDITS = 100;
export const TRIAL_PLAN_NAME = "trial";

export type TrialEligibilityRow = {
  has_used_trial?: boolean | null;
  stripe_subscription_id?: string | null;
  status?: string | null;
};

export function isEligibleForTrial(sub: TrialEligibilityRow | null): boolean {
  // One lifetime grant: only owners who have never had a billing row.
  // A trial, paid plan, cancel, or expiry all leave a row, so they never get another.
  return !sub;
}

export function isTrialPlanName(name: string | null | undefined): boolean {
  return name === TRIAL_PLAN_NAME;
}

export function trialDaysRemaining(
  trialEnd: string | Date | null | undefined,
  now: Date = new Date()
): number {
  if (!trialEnd) return 0;
  const end = trialEnd instanceof Date ? trialEnd : new Date(trialEnd);
  if (Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}
