import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
  updateCachedCredits,
} from "@/lib/workspace-context";

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

    const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
    const headers: Record<string, string> = {
      "X-Context-Source": ctx.source,
      "Server-Timing": `ctx;dur=${ctx.durationMs.toFixed(1)}`,
    };

    if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    }

    if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
      return NextResponse.json({ error: "An active subscription is required to use credits" }, { status: 402, headers });
    }

    // Use atomic RPC to deduct credits
    const admin = createAdminClient();
    const { data: result, error } = await admin.rpc("deduct_user_credits", {
      p_user_id: ctx.subscription.user_id,
      p_amount: amount,
      p_workspace_id: workspaceId,
      p_operation: operation,
      p_uid: user.id,
      p_entity_type: entityType || null,
      p_entity_id: entityId || null,
      p_details: details || {},
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers });
    }

    if (!result?.success) {
      return NextResponse.json({
        error: result?.error || "Deduction failed",
        remaining: result?.remaining ?? 0,
        required: amount,
      }, { status: 402, headers });
    }

    // Update cache with remaining credits
    updateCachedCredits(workspaceId, result.remaining ?? 0);

    return NextResponse.json({
      success: true,
      creditsUsed: amount,
      remaining: result.remaining,
    }, { headers });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
