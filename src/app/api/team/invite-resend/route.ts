import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  try {
    const { inviteId } = await request.json();

    if (!inviteId) {
      return NextResponse.json({ error: "Missing inviteId" }, { status: 400 });
    }

    // Verify caller is authenticated
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();

    // Fetch the invite
    const { data: invite, error: fetchErr } = await adminClient
      .from("workspace_invites")
      .select("*")
      .eq("id", inviteId)
      .is("accepted_at", null)
      .single();

    if (fetchErr || !invite) {
      return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
    }

    // Verify caller is owner/admin of the workspace
    const { data: member } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", invite.workspace_id)
      .eq("user_id", user.id)
      .single();

    if (!member || !["owner", "admin"].includes(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Build URLs
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:4000";
    const callbackUrl = `${origin}/auth/callback?next=/invite/${invite.token}`;

    // Check if this is an existing user or new user
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id, full_name")
      .ilike("email", invite.email)
      .maybeSingle();

    const isExistingUser = !!(existingProfile?.full_name);
    let emailSent = false;

    if (isExistingUser) {
      // Existing user — resend magic link
      const { error: otpSendErr } = await supabase.auth.signInWithOtp({
        email: invite.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: callbackUrl,
        },
      });

      if (!otpSendErr) {
        emailSent = true;
        console.log(`[Invite Resend] Sent magic link to existing user ${invite.email}`);
      } else {
        console.warn(`[Invite Resend] signInWithOtp failed: ${otpSendErr.message}`);
      }
    } else {
      // New user — resend invite email
      const { error: inviteEmailErr } = await adminClient.auth.admin.inviteUserByEmail(invite.email, {
        redirectTo: callbackUrl,
      });

      if (!inviteEmailErr) {
        emailSent = true;
        console.log(`[Invite Resend] Sent invite email to new user ${invite.email}`);
      } else {
        console.warn(`[Invite Resend] inviteUserByEmail failed: ${inviteEmailErr.message}`);
      }
    }

    return NextResponse.json({ emailSent });
  } catch (err: any) {
    console.error("[Invite Resend] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to resend invite" },
      { status: 500 }
    );
  }
}
