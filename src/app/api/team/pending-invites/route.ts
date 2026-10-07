import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user?.email) {
    return NextResponse.json({ invites: [] });
  }

  const admin = createAdminClient();

  // Find all pending invites for this user's email
  const { data: invites } = await admin
    .from("workspace_invites")
    .select("id, token, role, workspace_id, created_at")
    .ilike("email", user.email)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (!invites || invites.length === 0) {
    return NextResponse.json({ invites: [] });
  }

  // Fetch workspace names for each invite
  const workspaceIds = [...new Set(invites.map((i) => i.workspace_id))];
  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id, name, slug")
    .in("id", workspaceIds);

  const workspaceMap = new Map(
    (workspaces || []).map((w) => [w.id, { name: w.name, slug: w.slug }])
  );

  const enrichedInvites = invites.map((inv) => ({
    ...inv,
    workspace: workspaceMap.get(inv.workspace_id) || null,
  }));

  return NextResponse.json({ invites: enrichedInvites });
}
