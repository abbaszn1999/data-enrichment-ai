import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOwnerSubscription, isSubscriptionActive, invalidateSubscriptionCache } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const { workspaceId, amount, operation, entityType, entityId, details } = await request.json();

    if (!workspaceId || !amount || !operation) {
      return NextResponse.json({ error: "workspaceId, amount, and operation are required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get workspace owner's subscription
    const ownerSub = await getOwnerSubscription(workspaceId);
    if (!ownerSub) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    if (!isSubscriptionActive(ownerSub.subscription?.status)) {
      return NextResponse.json({ error: "An active subscription is required to use credits" }, { status: 402 });
    }

    // Use atomic RPC to deduct credits
    const admin = createAdminClient();
    const { data: result, error } = await admin.rpc("deduct_user_credits", {
      p_user_id: ownerSub.ownerId,
      p_amount: amount,
      p_workspace_id: workspaceId,
      p_operation: operation,
      p_uid: user.id,
      p_entity_type: entityType || null,
      p_entity_id: entityId || null,
      p_details: details || {},
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!result?.success) {
      return NextResponse.json({
        error: result?.error || "Deduction failed",
        remaining: result?.remaining ?? 0,
        required: amount,
      }, { status: 402 });
    }

    // Invalidate cached subscription data so next balance check reflects the deduction
    invalidateSubscriptionCache(workspaceId);

    return NextResponse.json({
      success: true,
      creditsUsed: amount,
      remaining: result.remaining,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
