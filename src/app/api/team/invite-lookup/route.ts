import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: invite, error } = await adminClient
    .from("workspace_invites")
    .select("*")
    .eq("token", token)
    .is("accepted_at", null)
    .single();

  if (error || !invite) {
    return NextResponse.json(
      { error: error?.code === "PGRST116" ? "Invite not found or already used" : "Invite is invalid or expired" },
      { status: 404 }
    );
  }

  // Check if invite has expired
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "This invite has expired. Please ask the workspace owner to send a new invite." },
      { status: 410 }
    );
  }

  const { data: workspace } = await adminClient
    .from("workspaces")
    .select("name, slug")
    .eq("id", invite.workspace_id)
    .single();

  // Check if the invited email belongs to an existing user who has a password set
  // (i.e. a real registered user, not just an invite-created stub)
  // We check profiles table — the handle_new_user trigger copies email there on signup
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id, full_name")
    .ilike("email", invite.email)
    .maybeSingle();

  // A user "exists" as a real user if they have a profile with a name set
  // (inviteUserByEmail creates auth.users entry but profile may have empty name)
  const isExistingUser = !!(existingProfile?.full_name);

  return NextResponse.json({ invite, workspace, isExistingUser });
}
