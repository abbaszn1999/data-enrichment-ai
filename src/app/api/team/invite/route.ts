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

    // Check if user already exists (via profiles table — efficient, no listUsers)
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id, full_name")
      .ilike("email", email)
      .maybeSingle();

    const isExistingUser = !!(existingProfile?.full_name);

    // Check if already a member of this workspace
    if (existingProfile) {
      const { data: existingMember } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", existingProfile.id)
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

    if (isExistingUser) {
      // ── EXISTING USER ──
      // Use signInWithOtp (magic link) — this ACTUALLY sends an email
      const { error: otpErr } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: inviteUrl },
      });

      if (otpErr) {
        console.warn(`[Invite] generateLink failed for existing user ${email}: ${otpErr.message}`);
      }

      // Also send a magic link via the client-side OTP method which reliably sends email
      const serverSupabase = await createClient();
      const { error: otpSendErr } = await serverSupabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: callbackUrl,
        },
      });

      if (otpSendErr) {
        console.warn(`[Invite] signInWithOtp failed for ${email}: ${otpSendErr.message}`);
        // Even if email fails, the invite link is still available for manual sharing
      } else {
        emailSent = true;
        console.log(`[Invite] Sent magic link to existing user ${email}`);
      }
    } else {
      // ── NEW USER ──
      // Use inviteUserByEmail — creates user + sends invite email in one step
      const { error: inviteEmailErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: callbackUrl,
      });

      if (inviteEmailErr) {
        console.warn(`[Invite] inviteUserByEmail failed for ${email}: ${inviteEmailErr.message}`);
        // Even if email fails, the invite link is still available for manual sharing
      } else {
        emailSent = true;
        console.log(`[Invite] Sent invite email to new user ${email}`);
      }
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
