import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { getOwnerSubscription, isSubscriptionActive } from "@/lib/stripe";
import { findAuthUserIdByEmail } from "@/lib/team/account-setup";

function cryptoRandomToken(): string {
  return randomBytes(32).toString("hex");
}

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

    const ownerSub = await getOwnerSubscription(workspaceId);
    const hasActiveSubscription = !!ownerSub?.subscription && isSubscriptionActive(ownerSub.subscription.status);

    if (!hasActiveSubscription) {
      return NextResponse.json(
        { error: "An active subscription is required before inviting team members" },
        { status: 403 }
      );
    }

    const maxMembers = ownerSub?.plan?.max_members_per_workspace;
    if (maxMembers) {
      const [{ count: memberCount }, { count: pendingInviteCount }] = await Promise.all([
        adminClient
          .from("workspace_members")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),
        adminClient
          .from("workspace_invites")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .is("accepted_at", null),
      ]);

      const currentSeatCount = (memberCount ?? 0) + (pendingInviteCount ?? 0);
      if (currentSeatCount >= maxMembers) {
        return NextResponse.json(
          { error: `Your current plan allows up to ${maxMembers} team members per workspace. Upgrade to invite more.` },
          { status: 403 }
        );
      }
    }

    const existingAuthUserId = await findAuthUserIdByEmail(adminClient, email);
    const isExistingUser = !!existingAuthUserId;

    if (existingAuthUserId) {
      const { data: existingMember } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", existingAuthUserId)
        .maybeSingle();

      if (existingMember) {
        return NextResponse.json(
          { error: "This user is already a member of the workspace" },
          { status: 409 }
        );
      }
    }

    // Create (or reuse) the invite record to get the token. A prior invite to
    // this email in this workspace may already exist — e.g. it was accepted
    // and the account was later deleted directly from the Supabase dashboard,
    // which only removes the auth.users row and never touches
    // workspace_invites.email (there's no FK on that column to cascade from).
    // Upsert instead of a plain insert so re-inviting never hits the
    // workspace_invites_workspace_id_email_key unique constraint.
    const { data: invite, error: inviteErr } = await adminClient
      .from("workspace_invites")
      .upsert(
        {
          workspace_id: workspaceId,
          email,
          role,
          invited_by: user.id,
          accepted_at: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          token: cryptoRandomToken(),
        },
        { onConflict: "workspace_id,email" }
      )
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
    const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(`/invite/${invite.token}`)}&email=${encodeURIComponent(email)}`;

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
      console.log(
        `[Invite] Sent magic link to ${isExistingUser ? "existing" : "new"} user ${email}, callbackUrl=${callbackUrl}`
      );
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
