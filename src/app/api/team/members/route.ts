import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Verify caller is a member of this workspace
    const { data: callerMember } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (!callerMember) {
      return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
    }

    // Fetch ALL members via admin client (bypasses RLS)
    const { data: members, error: membersErr } = await admin
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("joined_at", { ascending: true });

    if (membersErr) {
      return NextResponse.json({ error: membersErr.message }, { status: 500 });
    }

    if (!members || members.length === 0) {
      return NextResponse.json({ members: [] });
    }

    // Fetch profiles for all members
    const userIds = members.map((m: any) => m.user_id);
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", userIds);
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    // Fetch emails from auth.users for display
    const { data: authUsers } = await admin.auth.admin.listUsers();
    const emailMap = new Map(
      (authUsers?.users ?? []).map((u) => [u.id, u.email])
    );

    const enrichedMembers = members.map((m: any) => ({
      ...m,
      profiles: profileMap.get(m.user_id) || undefined,
      email: emailMap.get(m.user_id) || null,
    }));

    return NextResponse.json({ members: enrichedMembers });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

// ─── Update member role ──────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const { memberId, role } = await request.json();
    if (!memberId || !role) {
      return NextResponse.json({ error: "Missing memberId or role" }, { status: 400 });
    }
    if (!["admin", "editor", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const admin = createAdminClient();

    // Fetch the target member
    const { data: target } = await admin
      .from("workspace_members")
      .select("workspace_id, user_id, role")
      .eq("id", memberId)
      .single();
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    // Cannot change owner role
    if (target.role === "owner") {
      return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 403 });
    }

    // Verify caller is admin+ in this workspace
    const { data: caller } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", target.workspace_id)
      .eq("user_id", user.id)
      .single();
    if (!caller || !["owner", "admin"].includes(caller.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await admin
      .from("workspace_members")
      .update({ role })
      .eq("id", memberId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

// ─── Remove member ───────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const { memberId } = await request.json();
    if (!memberId) {
      return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const admin = createAdminClient();

    // Fetch the target member
    const { data: target } = await admin
      .from("workspace_members")
      .select("workspace_id, user_id, role")
      .eq("id", memberId)
      .single();
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    // Cannot remove the owner
    if (target.role === "owner") {
      return NextResponse.json({ error: "Cannot remove the workspace owner" }, { status: 403 });
    }

    // Cannot remove yourself (use leave workspace instead)
    if (target.user_id === user.id) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 403 });
    }

    // Verify caller is admin+ in this workspace
    const { data: caller } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", target.workspace_id)
      .eq("user_id", user.id)
      .single();
    if (!caller || !["owner", "admin"].includes(caller.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await admin
      .from("workspace_members")
      .delete()
      .eq("id", memberId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
