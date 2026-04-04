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

  // Check if user already exists in auth.users directly.
  // Cannot use profiles.full_name — inviteUserByEmail creates auth.users with no full_name.
  const { data: listData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  const existingAuthUser = listData?.users?.find(
    (u) => u.email?.toLowerCase() === invite.email.toLowerCase()
  );
  const isExistingUser = !!existingAuthUser;

  return NextResponse.json({ invite, workspace, isExistingUser });
}
