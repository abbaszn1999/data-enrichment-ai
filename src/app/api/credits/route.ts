import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getOwnerSubscription, calculateCreditBalance } from "@/lib/stripe";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Get owner's subscription (per-user model)
    const ownerSub = await getOwnerSubscription(workspaceId);
    const bal = calculateCreditBalance(ownerSub?.subscription ?? null);

    const admin = createAdminClient();

    // Get transactions
    const { data: transactions } = await admin
      .from("credit_transactions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);

    return NextResponse.json({
      balance: {
        used: bal.used,
        total: bal.monthlyTotal,
        bonus: bal.bonus,
        remaining: bal.total,
        resetsAt: ownerSub?.subscription?.credits_reset_at,
      },
      transactions: transactions || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
