import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOwnerSubscription, calculateCreditBalance } from "@/lib/stripe";

// Lightweight endpoint — returns ONLY the credit balance.
// No transactions, no members, no profiles.
// Used by useCredits hook, getBalance(), and pre-chat credit checks.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Lightweight auth: getSession reads cookies (no network call)
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const ownerSub = await getOwnerSubscription(workspaceId);
    const bal = calculateCreditBalance(ownerSub?.subscription ?? null);

    return NextResponse.json({
      used: bal.used,
      total: bal.monthlyTotal + bal.bonusAvailable,
      bonus: bal.bonus,
      remaining: bal.total,
      resetsAt: ownerSub?.subscription?.credits_reset_at ?? null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
