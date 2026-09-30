import type Stripe from "stripe";

export const STRIPE_STATUS_MAP: Record<string, string> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "cancelled",
  incomplete: "incomplete",
  incomplete_expired: "expired",
};

export function toStoredStatus(stripeStatus: string): string {
  return STRIPE_STATUS_MAP[stripeStatus] || stripeStatus;
}

/** API 2025-03-31.basil moved the subscription onto `invoice.parent`. */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  type SubscriptionRef = string | { id?: string } | null | undefined;
  const shape = invoice as unknown as {
    parent?: { subscription_details?: { subscription?: SubscriptionRef } | null } | null;
    subscription?: SubscriptionRef;
  };
  const raw = shape.parent?.subscription_details?.subscription ?? shape.subscription ?? null;
  if (!raw) return null;
  return typeof raw === "string" ? raw : raw.id ?? null;
}

/**
 * Included credits reset once per paid billing period: only for a paid
 * invoice on an active subscription whose period started after the last reset.
 * Mid-period invoices (plan changes, prorations) and re-deliveries never reset.
 */
export function shouldResetForPaidPeriod(params: {
  status: string;
  periodStartIso: string | null;
  creditsResetAt: string | null | undefined;
}): boolean {
  if (params.status !== "active" || !params.periodStartIso) return false;
  if (!params.creditsResetAt) return true;
  return new Date(params.creditsResetAt).getTime() < new Date(params.periodStartIso).getTime();
}
