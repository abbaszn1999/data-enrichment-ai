import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { stripe, getOrCreateStripeCustomer, creditsToUsd, CREDIT_TOPUP_MIN_CREDITS } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkoutBlockedReason, isSelfServePlanName } from "@/lib/billing/plans";
import { stripeCheckoutBlockedReason } from "@/lib/stripe-mode";

const LIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

export async function POST(request: NextRequest) {
  try {
    const blocked = stripeCheckoutBlockedReason();
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 503 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { type, planId, credits, billingCycle, workspaceSlug } = body;

    const admin = createAdminClient();
    const customerId = await getOrCreateStripeCustomer(user.id, user.email!);

    const successUrl = `${process.env.NEXT_PUBLIC_APP_URL}/w/${workspaceSlug}/subscription?success=true`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/w/${workspaceSlug}/subscription?cancelled=true`;

    if (type === "subscription") {
      if (typeof planId !== "string" || planId.startsWith("catalog:")) {
        return NextResponse.json({ error: "This plan cannot be purchased" }, { status: 400 });
      }

      const { data: plan } = await admin.from("subscription_plans").select("*").eq("id", planId).single();
      if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

      const blocked = checkoutBlockedReason(plan, billingCycle === "yearly" ? "yearly" : "monthly");
      if (blocked) {
        return NextResponse.json({ error: blocked }, { status: 400 });
      }
      if (!isSelfServePlanName(plan.name)) {
        return NextResponse.json({ error: "This plan cannot be purchased" }, { status: 400 });
      }

      const priceId = billingCycle === "yearly" ? plan.stripe_price_yearly_id : plan.stripe_price_monthly_id;
      if (!priceId) {
        return NextResponse.json({ error: "Stripe price not configured for this plan" }, { status: 400 });
      }

      // A live Stripe subscription is changed in the billing portal; a
      // cancelled or expired one needs a fresh checkout to resubscribe.
      const live = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      if (live.data.some((s) => LIVE_SUBSCRIPTION_STATUSES.has(s.status))) {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: successUrl,
        });
        return NextResponse.json({ url: portalSession.url });
      }

      // Only one subscription checkout may be open, so two tabs cannot both
      // be paid and leave the customer billed for two subscriptions.
      const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 20 });
      await Promise.all(
        open.data
          .filter((s) => s.mode === "subscription")
          .map((s) => stripe.checkout.sessions.expire(s.id).catch(() => undefined))
      );

      // Create new checkout session for subscription
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        metadata: { userId: user.id, planId: plan.id },
        subscription_data: {
          metadata: { userId: user.id, planId: plan.id },
        },
      });

      return NextResponse.json({ url: session.url });

    } else if (type === "credit_topup") {
      // Check user has active subscription
      const { data: sub } = await admin
        .from("user_subscriptions")
        .select("status")
        .eq("user_id", user.id)
        .single();

      if (!sub || sub.status !== "active") {
        return NextResponse.json({ error: "Active subscription required to buy extra credits" }, { status: 403 });
      }

      const creditsNum = Math.floor(Number(credits));
      if (!Number.isFinite(creditsNum) || creditsNum < CREDIT_TOPUP_MIN_CREDITS || creditsNum > 1_000_000) {
        return NextResponse.json(
          { error: `Minimum top-up is ${CREDIT_TOPUP_MIN_CREDITS} credits` },
          { status: 400 }
        );
      }

      const amountUsd = creditsToUsd(creditsNum);

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: Math.round(amountUsd * 100),
              product_data: {
                name: `${creditsNum.toLocaleString()} AI credits`,
                description: "One-time credit top-up",
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${successUrl}&topup=credits`,
        cancel_url: cancelUrl,
        metadata: {
          userId: user.id,
          credits: creditsNum.toString(),
        },
      });

      return NextResponse.json({ url: session.url });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (err: any) {
    console.error("[Stripe Checkout]", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
