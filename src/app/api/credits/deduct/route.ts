import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
  updateCachedCredits,
} from "@/lib/workspace-context";

export async function POST(request: Request) {
  // SEC-12: credits are charged only by server-side jobs after work is done.
  // Browser-chosen amounts are no longer accepted. (No in-app caller exists.)
  if (process.env.ALLOW_CLIENT_CREDIT_DEDUCT !== "true") {
    return NextResponse.json(
      { error: "Client-side credit deduction is disabled" },
      { status: 403 }
    );
  }
  try {
    const { workspaceId, amount, operation, entityType, entityId, details } = await request.json();

    if (!workspaceId || !amount || !operation) {
      return NextResponse.json({ error: "workspaceId, amount, and operation are required" }, { status: 400 });
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }
    if (typeof operation !== "string" || operation.length > 64) {
      return NextResponse.json({ error: "Invalid operation" }, { status: 400 });
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

    if (typeof result.remaining === "number") {
      updateCachedCredits(workspaceId, result.remaining);
    }

    return NextResponse.json({
      success: true,
      creditsUsed: amount,
      remaining: result.remaining,
    }, { headers });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
