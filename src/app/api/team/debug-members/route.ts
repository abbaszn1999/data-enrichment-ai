import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let workspaceId = searchParams.get("workspaceId");
  const slug = searchParams.get("slug");

  if (!workspaceId && !slug) {
    return NextResponse.json({ error: "Missing workspaceId or slug" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Resolve slug to ID if needed
  if (!workspaceId && slug) {
    const { data: ws } = await admin.from("workspaces").select("id").eq("slug", slug).single();
    if (!ws) return NextResponse.json({ error: "Workspace not found for slug: " + slug }, { status: 404 });
    workspaceId = ws.id;
  }

  // 1. Members via ADMIN (bypasses RLS)
  const { data: adminMembers, error: adminErr } = await admin
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId);

  // 2. Members via USER client (uses RLS)
  const { data: userMembers, error: userErr } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId);

  // 3. Invites via ADMIN
  const { data: invites } = await admin
    .from("workspace_invites")
    .select("*")
    .eq("workspace_id", workspaceId);

  // 4. Check if is_workspace_member function works
  const { data: fnCheck, error: fnErr } = await supabase.rpc("is_workspace_member", {
    ws_id: workspaceId,
    min_role: "viewer",
  });

  return NextResponse.json({
    currentUser: { id: user.id, email: user.email },
    adminQuery: { count: adminMembers?.length ?? 0, members: adminMembers, error: adminErr?.message },
    userQuery: { count: userMembers?.length ?? 0, members: userMembers, error: userErr?.message },
    invites: { count: invites?.length ?? 0, data: invites },
    isWorkspaceMemberFn: { result: fnCheck, error: fnErr?.message },
  });
}
