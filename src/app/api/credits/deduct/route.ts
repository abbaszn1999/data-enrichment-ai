import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const { workspaceId, amount, operation, entityType, entityId } = await request.json();

    if (!workspaceId || !amount || !operation) {
      return NextResponse.json({ error: "workspaceId, amount, and operation are required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check balance
    const { data: sub } = await supabase
      .from("workspace_subscriptions")
      .select("credits_used, subscription_plans(monthly_ai_credits)")
      .eq("workspace_id", workspaceId)
      .single();

    if (!sub) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    const total = (sub.subscription_plans as any)?.monthly_ai_credits ?? 0;
    const used = sub.credits_used ?? 0;
    const remaining = Math.max(0, total - used);

    if (remaining < amount) {
      return NextResponse.json({
        error: "Insufficient credits",
        remaining,
        required: amount,
      }, { status: 402 });
    }

    // Log transaction
    await supabase.from("credit_transactions").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      operation,
      credits_used: amount,
      entity_type: entityType || null,
      entity_id: entityId || null,
    });

    // Increment used count
    await supabase
      .from("workspace_subscriptions")
      .update({ credits_used: used + amount })
      .eq("workspace_id", workspaceId);

    return NextResponse.json({
      success: true,
      creditsUsed: amount,
      remaining: remaining - amount,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
