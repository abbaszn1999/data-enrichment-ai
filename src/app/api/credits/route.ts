import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const supabase = await createClient();

    // Get balance
    const { data: sub } = await supabase
      .from("workspace_subscriptions")
      .select("credits_used, credits_reset_at, subscription_plans(monthly_ai_credits)")
      .eq("workspace_id", workspaceId)
      .single();

    const total = (sub?.subscription_plans as any)?.monthly_ai_credits ?? 0;
    const used = sub?.credits_used ?? 0;

    // Get transactions
    const { data: transactions } = await supabase
      .from("credit_transactions")
      .select("*, profiles(full_name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    return NextResponse.json({
      balance: {
        used,
        total,
        remaining: Math.max(0, total - used),
        resetsAt: sub?.credits_reset_at,
      },
      transactions: transactions || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
