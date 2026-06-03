import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getCachedProductsCountServer, getCachedCategoriesCountServer } from "@/lib/storage-helpers-server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Load workspace context to verify membership
    const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
    const headers: Record<string, string> = {
      "X-Context-Source": ctx.source,
      "Server-Timing": `ctx;dur=${ctx.durationMs.toFixed(1)}`,
    };

    if (!ctx.membershipRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    }

    const admin = createAdminClient();
    const startQueries = Date.now();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

    // Parallelize all dashboard queries on the server side
    const [
      productsCount,
      categoriesCount,
      sessionsRes,
      membersRes,
      txRes,
      importSessionsRes,
    ] = await Promise.all([
      getCachedProductsCountServer(workspaceId).catch((err) => {
        console.warn("[Dashboard Summary] getCachedProductsCountServer failed:", err.message);
        return 0;
      }),
      getCachedCategoriesCountServer(workspaceId).catch((err) => {
        console.warn("[Dashboard Summary] getCachedCategoriesCountServer failed:", err.message);
        return 0;
      }),
      admin
        .from("import_sessions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      admin
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      admin
        .from("credit_transactions")
        .select("credits_used, operation, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: true }),
      admin
        .from("import_sessions")
        .select("id, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: true }),
    ]);

    if (sessionsRes.error) throw sessionsRes.error;
    if (membersRes.error) throw membersRes.error;
    if (txRes.error) throw txRes.error;
    if (importSessionsRes.error) throw importSessionsRes.error;

    const totalDbMs = Date.now() - startQueries;
    headers["Server-Timing"] = `ctx;dur=${ctx.durationMs.toFixed(1)}, db;dur=${totalDbMs.toFixed(1)}`;

    return NextResponse.json({
      stats: {
        totalProducts: productsCount,
        totalCategories: categoriesCount,
        recentImports: sessionsRes.count ?? 0,
        teamMembers: membersRes.count ?? 0,
      },
      creditTransactions: txRes.data ?? [],
      importSessions: importSessionsRes.data ?? [],
    }, { headers });
  } catch (err: any) {
    console.error("[Dashboard Summary API] error:", err);
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
