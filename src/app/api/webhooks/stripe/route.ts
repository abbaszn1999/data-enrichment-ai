import { NextRequest, NextResponse } from "next/server";
import { stripe, findPlanByStripePriceId, invalidateSubscriptionCache } from "@/lib/stripe";
import { isSelfServePlanName } from "@/lib/billing/plans";
import { stampFirstPaidAtIfNull } from "@/lib/billing/welcome-gift-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { creditWorkspaceWallet } from "@/lib/wallet/server";
import { creditFaWallet } from "@/lib/free-assessment/wallet-server";
import { clearWorkspaceContextCache } from "@/lib/workspace-context";
import {
  invoiceSubscriptionId,
  shouldResetForPaidPeriod,
  toStoredStatus,
} from "@/lib/billing/stripe-sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
    if (!webhookSecret) {
      return NextResponse.json({ error: "Webhook secret is not set" }, { status: 500 });
    }
    event = Stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("[Stripe Webhook] Signature failed:", (err as Error).message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Claim the event. A duplicate insert means another delivery already handled
  // (or is handling) it; the claim is released on failure so Stripe's retry
  // processes the event instead of being dropped as a duplicate.
  const { data: existing } = await admin.from("webhook_events").select("id").eq("id", event.id).maybeSingle();
  if (existing) return NextResponse.json({ received: true, duplicate: true });
  const { error: claimError } = await admin
    .from("webhook_events")
    .insert({ id: event.id, type: event.type, payload: event.data.object as unknown as Record<string, unknown> });
  if (claimError) {
    if (claimError.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    console.error(`[Webhook] Could not record ${event.type}:`, claimError.message);
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckout(event.data.object as Stripe.Checkout.Session, admin);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice, admin);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice, admin);
        break;
      case "customer.subscription.updated":
        await syncSubscription(admin, (event.data.object as Stripe.Subscription).id);
        break;
      case "customer.subscription.deleted":
        await handleSubDeleted(event.data.object as Stripe.Subscription, admin);
        break;
    }
    invalidateSubscriptionCache();
    clearWorkspaceContextCache();
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[Webhook] Error ${event.type}:`, message);
    await admin.from("webhook_events").delete().eq("id", event.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function toIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function handleCheckout(session: Stripe.Checkout.Session, admin: SupabaseClient) {
  const userId = session.metadata?.userId;
  if (!userId) return;
  // One-off payments are credited only once the money has cleared; delayed
  // methods complete later via checkout.session.async_payment_succeeded.
  if (session.mode === "payment" && session.payment_status !== "paid") return;

  if (session.metadata?.faWalletTopup === "1") {
    await handleFaWalletTopup(session, userId, admin);
    return;
  }

  if (session.metadata?.walletTopup === "1") {
    await handleWalletTopup(session, userId, admin);
    return;
  }

  if (session.mode === "subscription") {
    const subId = session.subscription as string;
    const customerId = session.customer as string;
    const planId = session.metadata?.planId;
    if (!planId || !subId) return;

    const { data: purchasedPlan } = await admin
      .from("subscription_plans")
      .select("name")
      .eq("id", planId)
      .maybeSingle();
    if (!isSelfServePlanName(purchasedPlan?.name)) {
      console.error("[Stripe Webhook] Refusing to create a non-self-serve plan from checkout", purchasedPlan?.name);
      return;
    }

    const stripeSub = await stripe.subscriptions.retrieve(subId);
    const item = stripeSub.items.data[0];
    const cycle = item?.price?.recurring?.interval === "year" ? "yearly" : "monthly";
    const status = toStoredStatus(stripeSub.status);

    const { error } = await admin.from("user_subscriptions").upsert({
      user_id: userId, plan_id: planId, billing_cycle: cycle, status,
      stripe_customer_id: customerId, stripe_subscription_id: subId,
      current_period_start: toIso(item?.current_period_start) ?? new Date().toISOString(),
      current_period_end: toIso(item?.current_period_end),
      cancel_at_period_end: stripeSub.cancel_at_period_end ?? false, credits_used: 0,
      trial_end: null, has_used_trial: true,
      credits_reset_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error(`Subscription activation failed: ${error.message}`);
    if (status === "active") await stampFirstPaidAtIfNull(admin, { userId });

  } else if (session.mode === "payment") {
    const credits = parseInt(session.metadata?.credits || "0", 10);
    if (!Number.isFinite(credits) || credits <= 0) return;

    const { data, error } = await admin.rpc("grant_purchased_credits", {
      p_user_id: userId,
      p_credits: credits,
      p_amount_paid: (session.amount_total || 0) / 100,
      p_checkout_session_id: session.id,
      p_payment_intent_id: (session.payment_intent as string) || null,
    });
    if (error) throw new Error(`Credit top-up failed: ${error.message}`);
    if (!data?.success) {
      // Not retryable: the buyer has no subscription row to hold the credits.
      console.error(
        `[Stripe Webhook] Credit top-up for session ${session.id} needs manual review:`,
        data?.error
      );
    }
  }
}

/** Credits the workspace wallet for a completed real-money top-up. Never
 *  called from the checkout route itself — only from here, once Stripe
 *  confirms the payment actually cleared. `session.id` is the idempotency
 *  key, so a re-delivered webhook (Stripe retries on any non-2xx) can never
 *  credit the same payment twice. */
async function handleWalletTopup(
  session: Stripe.Checkout.Session,
  userId: string,
  admin: SupabaseClient
) {
  const workspaceId = session.metadata?.workspaceId;
  if (!workspaceId) return;
  const targetCents = session.metadata?.targetAmountCents
    ? parseInt(session.metadata.targetAmountCents, 10)
    : (session.amount_subtotal ?? session.amount_total ?? 0);
  const amountUsd = targetCents > 0 ? targetCents / 100 : (session.amount_total ?? 0) / 100;
  if (amountUsd <= 0) return;

  const credited = await creditWorkspaceWallet(admin, {
    workspaceId,
    userId,
    amountUsd,
    kind: "topup",
    description: "Wallet top-up · card",
    module: "Billing",
    method: "Card",
    idempotencyKey: `stripe_checkout:${session.id}`,
    details: {
      stripeSessionId: session.id,
      stripePaymentIntentId: (session.payment_intent as string) || null,
      amountPaidUsd: (session.amount_total ?? 0) / 100,
    },
  });
  if (!credited.ok) {
    throw new Error(`Wallet top-up credit failed for session ${session.id}: ${credited.message}`);
  }
}

/** Credits the Free Assessment wallet only — never workspace_wallets. */
async function handleFaWalletTopup(
  session: Stripe.Checkout.Session,
  userId: string,
  admin: SupabaseClient
) {
  const workspaceId = session.metadata?.workspaceId;
  if (!workspaceId) return;
  const targetCents = session.metadata?.targetAmountCents
    ? parseInt(session.metadata.targetAmountCents, 10)
    : (session.amount_subtotal ?? session.amount_total ?? 0);
  const amountUsd = targetCents > 0 ? targetCents / 100 : (session.amount_total ?? 0) / 100;
  if (amountUsd <= 0) return;

  const credited = await creditFaWallet(admin, {
    workspaceId,
    userId,
    amountUsd,
    kind: "topup",
    description: "Free Assessment wallet top-up · card",
    module: "Billing",
    method: "Card",
    idempotencyKey: `fa_stripe_checkout:${session.id}`,
    details: {
      stripeSessionId: session.id,
      stripePaymentIntentId: (session.payment_intent as string) || null,
      amountPaidUsd: (session.amount_total ?? 0) / 100,
    },
  });
  if (!credited.ok) {
    throw new Error(`Free Assessment wallet top-up failed for session ${session.id}: ${credited.message}`);
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice, admin: SupabaseClient) {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId || invoice.billing_reason === "subscription_create") return;
  await syncSubscription(admin, subId, { paidPeriod: true });
}

async function handlePaymentFailed(invoice: Stripe.Invoice, admin: SupabaseClient) {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return;
  await syncSubscription(admin, subId);
}

/**
 * Mirrors the subscription's current state from Stripe (never the event
 * payload, which may be stale or delivered out of order). Included credits
 * reset once per paid billing period; spending is blocked by status otherwise.
 */
async function syncSubscription(admin: SupabaseClient, subId: string, opts: { paidPeriod?: boolean } = {}) {
  const sub = await stripe.subscriptions.retrieve(subId);
  const item = sub.items.data[0];
  const { data: row, error: rowError } = await admin
    .from("user_subscriptions")
    .select("credits_reset_at")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  if (rowError) throw new Error(rowError.message);
  if (!row) return;

  const plan = item?.price?.id ? await findPlanByStripePriceId(item.price.id) : null;
  const status = toStoredStatus(sub.status);
  const periodStart = toIso(item?.current_period_start);
  const resetForNewPeriod =
    !!opts.paidPeriod &&
    shouldResetForPaidPeriod({ status, periodStartIso: periodStart, creditsResetAt: row.credits_reset_at });
  const now = new Date().toISOString();

  const { error } = await admin.from("user_subscriptions").update({
    ...(plan ? { plan_id: plan.id } : {}),
    billing_cycle: item?.price?.recurring?.interval === "year" ? "yearly" : "monthly",
    status,
    cancel_at_period_end: sub.cancel_at_period_end,
    current_period_start: periodStart ?? now,
    current_period_end: toIso(item?.current_period_end),
    ...(resetForNewPeriod ? { credits_used: 0, credits_reset_at: now } : {}),
    ...(status === "cancelled" ? { cancelled_at: now } : {}),
    ...(status === "active" ? { trial_end: null, has_used_trial: true } : {}),
    updated_at: now,
  }).eq("stripe_subscription_id", sub.id);
  if (error) throw new Error(error.message);

  if (status === "active") {
    await stampFirstPaidAtIfNull(admin, { stripeSubscriptionId: sub.id });
  }
}

async function handleSubDeleted(sub: Stripe.Subscription, admin: SupabaseClient) {
  const { error } = await admin.from("user_subscriptions").update({
    status: "cancelled", credits_used: 0, cancel_at_period_end: false,
    cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("stripe_subscription_id", sub.id);
  if (error) throw new Error(error.message);
}
