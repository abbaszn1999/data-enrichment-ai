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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
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
