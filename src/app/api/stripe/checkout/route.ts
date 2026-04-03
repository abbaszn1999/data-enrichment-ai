import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { type, planId, packId, billingCycle, workspaceSlug } = body;

    const admin = createAdminClient();
    const customerId = await getOrCreateStripeCustomer(user.id, user.email!);

    const successUrl = `${process.env.NEXT_PUBLIC_APP_URL}/w/${workspaceSlug}/subscription?success=true`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/w/${workspaceSlug}/subscription?cancelled=true`;

    if (type === "subscription") {
      // Get plan details
      const { data: plan } = await admin.from("subscription_plans").select("*").eq("id", planId).single();
      if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

      const priceId = billingCycle === "yearly" ? plan.stripe_price_yearly_id : plan.stripe_price_monthly_id;
      if (!priceId) return NextResponse.json({ error: "Stripe price not configured for this plan" }, { status: 400 });

      // Check if user already has an active Stripe subscription
      const { data: existingSub } = await admin
        .from("user_subscriptions")
        .select("stripe_subscription_id")
        .eq("user_id", user.id)
        .single();

      if (existingSub?.stripe_subscription_id) {
        // Use Stripe billing portal for upgrades/downgrades
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: successUrl,
        });
        return NextResponse.json({ url: portalSession.url });
      }

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

    } else if (type === "credit_pack") {
      // Check user has active subscription
      const { data: sub } = await admin
        .from("user_subscriptions")
        .select("status")
        .eq("user_id", user.id)
        .single();

      if (!sub || !["active", "trialing"].includes(sub.status)) {
        return NextResponse.json({ error: "Active subscription required to purchase credit packs" }, { status: 403 });
      }

      // Get pack details
      const { data: pack } = await admin.from("credit_packs").select("*").eq("id", packId).single();
      if (!pack) return NextResponse.json({ error: "Credit pack not found" }, { status: 404 });

      if (!pack.stripe_price_id) {
        return NextResponse.json({ error: "Stripe price not configured for this pack" }, { status: 400 });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        line_items: [{ price: pack.stripe_price_id, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        metadata: {
          userId: user.id,
          packId: pack.id,
          credits: pack.credits.toString(),
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
