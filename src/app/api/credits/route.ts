import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { getWorkspaceContext, isContextSubscriptionActive } from "@/lib/workspace-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const format = searchParams.get("format");
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
    let txQuery = admin
      .from("credit_transactions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(format === "csv" ? Math.min(limit, 5000) : limit);
    if (from) txQuery = txQuery.gte("created_at", from);
    if (to) txQuery = txQuery.lte("created_at", to);

    const [txRes, membersRes, totalsRes] = await Promise.all([
      txQuery,
      admin
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", workspaceId),
      admin.rpc("credit_usage_totals", { p_workspace_id: workspaceId }),
    ]);

    if (txRes.error) throw txRes.error;
    if (membersRes.error) throw membersRes.error;
    const totals =
      totalsRes.data && typeof totalsRes.data === "object"
        ? (totalsRes.data as { total_used?: number; total_count?: number })
        : {};

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

    const mapped = (transactions || []).map((tx: any) => ({
      ...tx,
      user_name: tx.user_id ? profilesById.get(tx.user_id) || null : null,
    }));

    if (format === "csv") {
      const header = ["created_at", "operation", "credits_used", "user", "status"];
      const lines = [
        header.join(","),
        ...mapped.map((tx: any) =>
          [
            tx.created_at ?? "",
            tx.operation ?? "",
            tx.credits_used ?? "",
            JSON.stringify(tx.user_name ?? ""),
            tx.status ?? "",
          ].join(",")
        ),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="usage-${workspaceId}.csv"`,
        },
      });
    }

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
      transactions: mapped,
      members: (members || []).map((m: any) => ({
        userId: m.user_id,
        role: m.role,
        fullName: profilesById.get(m.user_id) || "Unknown",
      })),
      totalAllTime: Number(totals.total_used ?? 0),
      totalTransactions: Number(totals.total_count ?? 0),
    }, { headers });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
