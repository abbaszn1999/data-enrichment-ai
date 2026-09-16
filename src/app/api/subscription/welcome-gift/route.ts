import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import {
  calculateCreditBalance,
  getOwnerSubscription,
  invalidateSubscriptionCache,
} from "@/lib/stripe";
import { clearWorkspaceContextCache } from "@/lib/workspace-context";
import {
  EMPTY_WELCOME_GIFT,
  welcomeGiftFromSubscription,
} from "@/lib/billing/welcome-gift";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({
    workspaceId: parsed.data.workspaceId,
    requireWrite: true,
  });
  if (!auth.ok) return auth.response;

  if (auth.user.id !== auth.ctx.ownerId) {
    return NextResponse.json(
      { error: "Only the workspace owner can claim this gift" },
      { status: 403, headers: auth.headers }
    );
  }

  const { data, error } = await auth.admin.rpc("claim_welcome_credit_gift", {
    p_user_id: auth.user.id,
  });
  if (error) {
    console.error("[welcome-gift] claim failed", error.message);
    return NextResponse.json(
      { error: "Could not claim the gift" },
      { status: 500, headers: auth.headers }
    );
  }
  if (data == null) {
    return NextResponse.json(
      { error: "This gift is not available" },
      { status: 409, headers: auth.headers }
    );
  }

  invalidateSubscriptionCache(parsed.data.workspaceId);
  clearWorkspaceContextCache(parsed.data.workspaceId);

  const ownerSub = await getOwnerSubscription(parsed.data.workspaceId);
  const sub = ownerSub?.subscription ?? null;
  const credits = calculateCreditBalance(sub);

  return NextResponse.json(
    {
      ok: true,
      credits,
      welcomeGift: sub
        ? welcomeGiftFromSubscription({
            isOwner: true,
            planName: ownerSub?.plan?.name,
            subscription: sub,
          })
        : { ...EMPTY_WELCOME_GIFT, claimedAt: new Date().toISOString() },
    },
    { headers: auth.headers }
  );
}
