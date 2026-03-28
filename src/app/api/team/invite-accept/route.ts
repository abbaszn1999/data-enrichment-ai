import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  const { inviteId } = await request.json();

  if (!inviteId) {
    return NextResponse.json({ error: "Missing inviteId" }, { status: 400 });
  }

  // Get the authenticated user from the server-side session (cookies)
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Fetch the invite
  const { data: invite, error: fetchErr } = await admin
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .is("accepted_at", null)
    .single();

  if (fetchErr || !invite) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
  }

  // Check not already a member
  const { data: existing } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    // Add member
    const { error: insertErr } = await admin.from("workspace_members").insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
    });
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  // Mark invite accepted
  await admin
    .from("workspace_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", inviteId);

  return NextResponse.json({ success: true, workspaceId: invite.workspace_id });
}
