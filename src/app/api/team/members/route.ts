import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

// ─── In-memory caches ────────────────────────────────────
// Cache auth user emails so we don't call listUsers() on every request
let _authEmailCache: { map: Map<string, string | undefined>; ts: number } = { map: new Map(), ts: 0 };
const AUTH_EMAIL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache full team response per workspace
const _teamCache = new Map<string, { data: any; ts: number }>();
const TEAM_CACHE_TTL = 60 * 1000; // 60 seconds

// Call this to bust team cache when members change
function invalidateTeamCache(workspaceId: string) {
  _teamCache.delete(workspaceId);
}

async function getCachedAuthEmails(admin: ReturnType<typeof createAdminClient>) {
  if (_authEmailCache.map.size > 0 && Date.now() - _authEmailCache.ts < AUTH_EMAIL_CACHE_TTL) {
    return _authEmailCache.map;
  }
  const { data: authUsers } = await admin.auth.admin.listUsers();
  const map = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email]));
  _authEmailCache = { map, ts: Date.now() };
  return map;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    // Auth check (reads cookies — no network call)
    const supabase = await createClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    const user = session?.user;
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Return cached response if fresh
    const cached = _teamCache.get(workspaceId);
    if (cached && Date.now() - cached.ts < TEAM_CACHE_TTL) {
      // Still verify caller is in cached members
      const isMember = cached.data.some((m: any) => m.user_id === user.id);
      if (isMember) {
        return NextResponse.json({ members: cached.data });
      }
    }

    const admin = createAdminClient();

    // Fetch ALL members for the workspace
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

    // Verify caller is in the members array (in-memory — 0ms)
    const callerMember = members.find((m: any) => m.user_id === user.id);
    if (!callerMember) {
      return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
    }

    // Parallelize profiles + cached emails
    const userIds = members.map((m: any) => m.user_id);

    const [profilesResponse, emailMap] = await Promise.all([
      admin.from("profiles").select("id, full_name, avatar_url").in("id", userIds),
      getCachedAuthEmails(admin),
    ]);

    const profileMap = new Map((profilesResponse.data ?? []).map((p: any) => [p.id, p]));

    const enrichedMembers = members.map((m: any) => ({
      ...m,
      profiles: profileMap.get(m.user_id) || undefined,
      email: emailMap.get(m.user_id) || null,
    }));

    // Cache the result
    _teamCache.set(workspaceId, { data: enrichedMembers, ts: Date.now() });

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
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
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

    // Bust team cache so next GET reflects the change
    invalidateTeamCache(target.workspace_id);

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
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
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

    // Bust team cache so next GET reflects the change
    invalidateTeamCache(target.workspace_id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
