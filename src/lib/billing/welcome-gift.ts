export const WELCOME_GIFT_CREDITS = 5000;
export const WELCOME_GIFT_DAYS = 30;

export type WelcomeGiftState = {
  eligible: boolean;
  credits: number;
  expiresAt: string | null;
  claimedAt: string | null;
};

export const EMPTY_WELCOME_GIFT: WelcomeGiftState = {
  eligible: false,
  credits: WELCOME_GIFT_CREDITS,
  expiresAt: null,
  claimedAt: null,
};

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function welcomeGiftExpiresAt(firstPaidAt: Date): Date {
  return new Date(firstPaidAt.getTime() + WELCOME_GIFT_DAYS * 86_400_000);
}

export function isWelcomeGiftPlan(name: string | null | undefined): boolean {
  return name === "growth" || name === "pro";
}

export function welcomeGiftFromSubscription(input: {
  isOwner: boolean;
  planName: string | null | undefined;
  subscription: {
    status?: string | null;
    stripe_subscription_id?: string | null;
    first_paid_at?: string | Date | null;
    welcome_gift_claimed_at?: string | Date | null;
  } | null;
  now?: Date;
}): WelcomeGiftState {
  return welcomeGiftState({
    isOwner: input.isOwner,
    planName: input.planName,
    status: input.subscription?.status,
    stripeSubscriptionId: input.subscription?.stripe_subscription_id,
    firstPaidAt: input.subscription?.first_paid_at,
    claimedAt: input.subscription?.welcome_gift_claimed_at,
    now: input.now,
  });
}

export function welcomeGiftState(input: {
  isOwner: boolean;
  planName: string | null | undefined;
  status: string | null | undefined;
  stripeSubscriptionId: string | null | undefined;
  firstPaidAt: string | Date | null | undefined;
  claimedAt: string | Date | null | undefined;
  now?: Date;
}): WelcomeGiftState {
  const claimed = parseDate(input.claimedAt);
  const firstPaid = parseDate(input.firstPaidAt);
  const expiresAt = firstPaid ? welcomeGiftExpiresAt(firstPaid) : null;
  const now = input.now ?? new Date();
  const eligible =
    input.isOwner &&
    isWelcomeGiftPlan(input.planName) &&
    input.status === "active" &&
    Boolean(input.stripeSubscriptionId) &&
    firstPaid !== null &&
    claimed === null &&
    expiresAt !== null &&
    now.getTime() < expiresAt.getTime();

  return {
    eligible,
    credits: WELCOME_GIFT_CREDITS,
    expiresAt: expiresAt?.toISOString() ?? null,
    claimedAt: claimed?.toISOString() ?? null,
  };
}

export function isWelcomeGiftOpen(
  state: WelcomeGiftState,
  now: Date = new Date()
): boolean {
  if (!state.eligible || !state.expiresAt || state.claimedAt) return false;
  return new Date(state.expiresAt).getTime() > now.getTime();
}

export function formatWelcomeGiftRemaining(
  expiresAt: string | Date,
  now: Date = new Date()
): string {
  const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const ms = Math.max(0, end.getTime() - now.getTime());
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}
