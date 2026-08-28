import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { findAuthUserIdByEmail, userNeedsAccountSetup } from "@/lib/team/account-setup";

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

  const existingAuthUserId = await findAuthUserIdByEmail(adminClient, invite.email);
  const isExistingUser = existingAuthUserId
    ? !(await userNeedsAccountSetup(adminClient, existingAuthUserId))
    : false;

  return NextResponse.json({ invite, workspace, isExistingUser });
}
