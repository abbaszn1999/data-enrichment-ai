import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { stripe } from "@/lib/stripe";
import { getOrCreateWalletStripeCustomer } from "@/lib/wallet/stripe-customer";
import { stripeCheckoutBlockedReason } from "@/lib/stripe-mode";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceSlug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "Invalid workspace slug"),
  amountUsd: z.number().min(5).max(10_000),
});

/** Starts a real Stripe Checkout session to add funds to the workspace
 *  wallet. The actual credit happens in the `checkout.session.completed`
 *  webhook (src/app/api/webhooks/stripe/route.ts) once payment clears —
 *  never here, since this request can be abandoned or the tab can close. */
export async function POST(request: NextRequest) {
  const blocked = stripeCheckoutBlockedReason();
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 503 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid checkout payload" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({
    workspaceId: parsed.data.workspaceId,
    requireWrite: true,
  });
  if (!auth.ok) return auth.response;

  const amountUsd = Math.round(parsed.data.amountUsd * 100) / 100;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const returnBase = `${appUrl}/w/${parsed.data.workspaceSlug}/wallet`;

  try {
    const customerId = await getOrCreateWalletStripeCustomer(
      auth.admin,
      auth.user.id,
      auth.user.email ?? ""
    );

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amountUsd * 100),
            product_data: {
              name: "Wallet top-up",
              description: `Add $${amountUsd.toFixed(2)} to the workspace wallet`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${returnBase}?topup=success`,
      cancel_url: `${returnBase}?topup=cancelled`,
      metadata: {
        walletTopup: "1",
        workspaceId: parsed.data.workspaceId,
        userId: auth.user.id,
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL" },
        { status: 500, headers: auth.headers }
      );
    }

    return NextResponse.json({ url: session.url }, { headers: auth.headers });
  } catch (error) {
    console.error("[wallet checkout]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start checkout" },
      { status: 500, headers: auth.headers }
    );
  }
}
