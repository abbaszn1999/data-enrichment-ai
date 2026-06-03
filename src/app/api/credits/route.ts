import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { getWorkspaceContext, isContextSubscriptionActive } from "@/lib/workspace-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
    const headers: Record<string, string> = {
      "X-Context-Source": ctx.source,
      "Server-Timing": `ctx;dur=${ctx.durationMs.toFixed(1)}`,
    };

    const admin = createAdminClient();

    const startQueries = Date.now();

    // Get transactions and members in parallel
    const [txRes, membersRes] = await Promise.all([
      admin
        .from("credit_transactions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit),
      admin
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", workspaceId),
    ]);

    if (txRes.error) throw txRes.error;
    if (membersRes.error) throw membersRes.error;

    const transactions = txRes.data;
    const members = membersRes.data;

    const profileIds = Array.from(
      new Set([
        ...(transactions || []).map((tx: any) => tx.user_id).filter(Boolean),
        ...(members || []).map((m: any) => m.user_id).filter(Boolean),
      ])
    );

    let profilesById = new Map<string, string>();
    if (profileIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds);

      if (profilesError) {
        throw profilesError;
      }

      profilesById = new Map((profiles || []).map((profile: any) => [profile.id, profile.full_name || "Unknown"]));
    }

    const totalDbMs = Date.now() - startQueries;
    headers["Server-Timing"] = `ctx;dur=${ctx.durationMs.toFixed(1)}, db;dur=${totalDbMs.toFixed(1)}`;

    return NextResponse.json({
      balance: {
        used: ctx.credits.used,
        total: ctx.credits.monthlyTotal + ctx.credits.bonusAvailable,
        bonus: ctx.credits.bonus,
        remaining: ctx.credits.total,
        resetsAt: ctx.subscription?.credits_reset_at,
      },
      plan: ctx.plan ? {
        displayName: ctx.plan.display_name,
        monthlyCredits: ctx.plan.monthly_ai_credits,
        priceMonthly: ctx.plan.price_monthly,
        priceYearly: ctx.plan.price_yearly,
      } : null,
      subscription: ctx.subscription ? {
        status: ctx.subscription.status,
        isActive: isContextSubscriptionActive(ctx),
        billingCycle: ctx.subscription.billing_cycle,
        cancelAtPeriodEnd: ctx.subscription.cancel_at_period_end,
        currentPeriodEnd: ctx.subscription.current_period_end,
      } : null,
      transactions: (transactions || []).map((tx: any) => ({
        ...tx,
        user_name: tx.user_id ? profilesById.get(tx.user_id) || null : null,
      })),
      members: (members || []).map((m: any) => ({
        userId: m.user_id,
        role: m.role,
        fullName: profilesById.get(m.user_id) || "Unknown",
      })),
    }, { headers });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
