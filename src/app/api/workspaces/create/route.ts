import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getUserSubscription, isSubscriptionActive } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    // Get the authenticated user from the request
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { name, slug, description, cms_type } = body;

    if (!name?.trim() || !slug?.trim()) {
      return NextResponse.json({ error: "Name and slug are required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Check user's subscription and max_workspaces limit
    const userSub = await getUserSubscription(user.id);
    if (!userSub || !isSubscriptionActive(userSub.subscription.status)) {
      return NextResponse.json({ error: "Active subscription required to create workspaces" }, { status: 403 });
    }

    const maxWorkspaces = userSub.plan?.max_workspaces;
    if (maxWorkspaces) {
      // Count user's current workspaces (as owner)
      const { count } = await admin
        .from("workspaces")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id);

      if ((count ?? 0) >= maxWorkspaces) {
        return NextResponse.json({
          error: `Your plan allows a maximum of ${maxWorkspaces} workspace(s). Upgrade to create more.`,
        }, { status: 403 });
      }
    }

    // 1. Create workspace
    const { data: workspace, error: wsError } = await admin
      .from("workspaces")
      .insert({
        name: name.trim(),
        slug: slug.trim(),
        description: description?.trim() || "",
        cms_type: cms_type || "custom",
        owner_id: user.id,
      })
      .select()
      .single();

    if (wsError) {
      if (wsError.message?.includes("duplicate")) {
        return NextResponse.json({ error: "A workspace with this slug already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: wsError.message }, { status: 500 });
    }

    // 2. Add creator as owner member
    const { error: memberError } = await admin
      .from("workspace_members")
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: "owner",
      });

    if (memberError) {
      // Rollback workspace creation
      await admin.from("workspaces").delete().eq("id", workspace.id);
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    return NextResponse.json(workspace);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
