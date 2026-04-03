import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Supabase may pass redirect_to as the full callback URL we set in emailRedirectTo/redirectTo.
  // For example: http://localhost:4000/auth/callback?next=/invite/xxx
  // We need to extract the actual "next" from that URL if it's a callback URL.
  let next = searchParams.get("next") || "/workspaces";

  const redirectTo = searchParams.get("redirect_to");
  if (redirectTo) {
    try {
      // If redirect_to is a full URL, parse it to extract the "next" param
      if (redirectTo.startsWith("http")) {
        const redirectUrl = new URL(redirectTo);
        // If it points to our own callback, extract the nested "next"
        if (redirectUrl.pathname === "/auth/callback") {
          next = redirectUrl.searchParams.get("next") || next;
        } else {
          // It's a direct URL (e.g. /invite/xxx page)
          next = redirectUrl.pathname + redirectUrl.search;
        }
      } else {
        // It's a relative path
        next = redirectTo;
      }
    } catch {
      // If URL parsing fails, use as-is
      next = redirectTo;
    }
  }

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Check if this is a newly invited user who needs to set a password.
      // Users created via inviteUserByEmail have no password set.
      // We detect this by: redirect is to an invite page + user was created recently (within 5 min of last sign-in)
      const inviteMatch = next.match(/^\/invite\/([a-zA-Z0-9-]+)$/);
      if (inviteMatch && data?.user) {
        const user = data.user;
        const createdAt = new Date(user.created_at).getTime();
        const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
        // If this is the user's first sign-in (created_at ≈ last_sign_in_at within 2 min), 
        // they are a new invited user who needs to set a password
        const isFirstSignIn = Math.abs(createdAt - lastSignIn) < 120000;
        // Also check if they have no password set via user_metadata or identities
        const hasNoPassword = !user.user_metadata?.full_name;

        if (isFirstSignIn && hasNoPassword) {
          const token = inviteMatch[1];
          return NextResponse.redirect(`${origin}/invite/${token}/setup`);
        }
      }

      // If next is a full URL, redirect directly
      if (next.startsWith("http")) {
        return NextResponse.redirect(next);
      }
      // Ensure next starts with /
      const safePath = next.startsWith("/") ? next : `/${next}`;
      return NextResponse.redirect(`${origin}${safePath}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
