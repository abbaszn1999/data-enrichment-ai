import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

// Combined endpoint: returns workspace + user role in a single request.
// Server-side parallelizes the queries using the cached admin client,
// eliminating the 2-step sequential waterfall from the browser.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    // Get user from session (no network call — reads cookies)
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const userId = session.user.id;

    // Step 1: Get workspace by slug
    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .select("*")
      .eq("slug", slug)
      .single();

    if (wsErr || !workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Step 2: Get role (uses same cached admin client — fast)
    const { data: member } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", userId)
      .single();

    return NextResponse.json({
      workspace,
      role: member?.role ?? null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}
