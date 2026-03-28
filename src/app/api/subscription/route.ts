import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: sub, error } = await supabase
      .from("workspace_subscriptions")
      .select("*, subscription_plans(*)")
      .eq("workspace_id", workspaceId)
      .single();

    if (error && error.code !== "PGRST116") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get all available plans
    const { data: plans } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    return NextResponse.json({
      subscription: sub || null,
      currentPlan: sub?.subscription_plans || null,
      availablePlans: plans || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { workspaceId, planId } = await request.json();

    if (!workspaceId || !planId) {
      return NextResponse.json({ error: "workspaceId and planId are required" }, { status: 400 });
    }

    const supabase = await createClient();

    // Check workspace ownership
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("owner_id")
      .eq("id", workspaceId)
      .single();

    if (!workspace || workspace.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the workspace owner can change the plan" }, { status: 403 });
    }

    // Update subscription
    const { error } = await supabase
      .from("workspace_subscriptions")
      .update({
        plan_id: planId,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
