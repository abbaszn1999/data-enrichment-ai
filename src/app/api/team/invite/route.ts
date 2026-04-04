import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, email, role } = await request.json();

    if (!workspaceId || !email || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify caller is authenticated and is owner/admin
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: member } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (!member || !["owner", "admin"].includes(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Check if user already exists in auth.users directly.
    // We cannot use profiles.full_name because inviteUserByEmail creates an auth.users
    // record with no full_name, making the user appear "new" on subsequent invites → 422.
    const { data: listData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const existingAuthUser = listData?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    const isExistingUser = !!existingAuthUser;

    // Check if already a member of this workspace
    if (existingAuthUser) {
      const { data: existingMember } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", existingAuthUser.id)
        .maybeSingle();

      if (existingMember) {
        return NextResponse.json(
          { error: "This user is already a member of the workspace" },
          { status: 409 }
        );
      }
    }

    // Create invite record in DB to get the token
    const { data: invite, error: inviteErr } = await supabase
      .from("workspace_invites")
      .insert({ workspace_id: workspaceId, email, role, invited_by: user.id })
      .select()
      .single();

    if (inviteErr || !invite) {
      throw new Error(inviteErr?.message || "Failed to create invite");
    }

    // Build URLs
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:4000";
    const inviteUrl = `${origin}/invite/${invite.token}`;
    const callbackUrl = `${origin}/auth/callback?next=/invite/${invite.token}`;

    let emailSent = false;

    // Use signInWithOtp for BOTH existing and new users.
    // - For existing users: shouldCreateUser=false → sends magic link to existing account
    // - For new users: shouldCreateUser=true → creates account + sends magic link
    // signInWithOtp uses PKCE flow → sends email with link that redirects to callback with ?code=
    // This avoids inviteUserByEmail's implicit flow (#access_token) which server callback can't read.
    const serverSupabase = await createClient();
    const { error: otpSendErr } = await serverSupabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: !isExistingUser, // create account only for new users
        emailRedirectTo: callbackUrl,
      },
    });

    if (otpSendErr) {
      console.warn(`[Invite] signInWithOtp failed for ${email}: ${otpSendErr.message}`);
    } else {
      emailSent = true;
      console.log(`[Invite] Sent magic link to ${isExistingUser ? "existing" : "new"} user ${email}`);
    }

    return NextResponse.json({
      invite,
      inviteUrl,
      emailSent,
      isExistingUser,
    });
  } catch (err: any) {
    console.error("[Invite] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to send invite" },
      { status: 500 }
    );
  }
}
