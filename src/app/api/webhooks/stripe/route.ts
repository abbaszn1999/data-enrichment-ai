import { NextRequest, NextResponse } from "next/server";
import { stripe, findPlanByStripePriceId } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency check
  const { data: existing } = await admin.from("webhook_events").select("id").eq("id", event.id).maybeSingle();
  if (existing) return NextResponse.json({ received: true, duplicate: true });

  await admin.from("webhook_events").insert({ id: event.id, type: event.type, payload: event.data.object as any });

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckout(event.data.object as Stripe.Checkout.Session, admin);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice, admin);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice, admin);
        break;
      case "customer.subscription.updated":
        await handleSubUpdated(event.data.object as Stripe.Subscription, admin);
        break;
      case "customer.subscription.deleted":
        await handleSubDeleted(event.data.object as Stripe.Subscription, admin);
        break;
    }
  } catch (err: any) {
    console.error(`[Webhook] Error ${event.type}:`, err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckout(session: Stripe.Checkout.Session, admin: any) {
  const userId = session.metadata?.userId;
  if (!userId) return;

  if (session.mode === "subscription") {
    const subId = session.subscription as string;
    const customerId = session.customer as string;
    const planId = session.metadata?.planId;
    if (!planId) return;

    const stripeSub = await stripe.subscriptions.retrieve(subId);
    const item = stripeSub.items.data[0];
    const cycle = item?.price?.recurring?.interval === "year" ? "yearly" : "monthly";
    const periodStart = item?.current_period_start;
    const periodEnd = item?.current_period_end;

    await admin.from("user_subscriptions").upsert({
      user_id: userId, plan_id: planId, billing_cycle: cycle, status: "active",
      stripe_customer_id: customerId, stripe_subscription_id: subId,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: false, credits_used: 0,
      credits_reset_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  } else if (session.mode === "payment") {
    const credits = parseInt(session.metadata?.credits || "0", 10);
    if (!credits) return;

    const { data: sub } = await admin.from("user_subscriptions").select("bonus_credits").eq("user_id", userId).single();
    if (sub) {
      await admin.from("user_subscriptions").update({
        bonus_credits: (sub.bonus_credits || 0) + credits, updated_at: new Date().toISOString(),
      }).eq("user_id", userId);
    }

    await admin.from("credit_purchases").insert({
      user_id: userId, pack_id: session.metadata?.packId || null, credits,
      amount_paid: (session.amount_total || 0) / 100,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: (session.payment_intent as string) || null,
      status: "completed",
    });
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice, admin: any) {
  const subId = (invoice as any).subscription as string;
  if (!subId || invoice.billing_reason === "subscription_create") return;

  await admin.from("user_subscriptions").update({
    status: "active", credits_used: 0, credits_reset_at: new Date().toISOString(),
    current_period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : new Date().toISOString(),
    current_period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    cancel_at_period_end: false, updated_at: new Date().toISOString(),
  }).eq("stripe_subscription_id", subId);
}

async function handlePaymentFailed(invoice: Stripe.Invoice, admin: any) {
  const subId = (invoice as any).subscription as string;
  if (!subId) return;
  await admin.from("user_subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", subId);
}

async function handleSubUpdated(sub: Stripe.Subscription, admin: any) {
  const priceId = sub.items.data[0]?.price?.id;
  const cycle = sub.items.data[0]?.price?.recurring?.interval === "year" ? "yearly" : "monthly";

  let planUpdate: any = {};
  if (priceId) {
    const plan = await findPlanByStripePriceId(priceId);
    if (plan) planUpdate.plan_id = plan.id;
  }

  const statusMap: Record<string, string> = {
    active: "active", trialing: "trialing", past_due: "past_due",
    canceled: "cancelled", incomplete: "incomplete", incomplete_expired: "expired",
  };

  const subItem = sub.items.data[0];
  const periodStart = subItem?.current_period_start;
  const periodEnd = subItem?.current_period_end;

  await admin.from("user_subscriptions").update({
    ...planUpdate, billing_cycle: cycle, status: statusMap[sub.status] || sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("stripe_subscription_id", sub.id);
}

async function handleSubDeleted(sub: Stripe.Subscription, admin: any) {
  await admin.from("user_subscriptions").update({
    status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("stripe_subscription_id", sub.id);
}
