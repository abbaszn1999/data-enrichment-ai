"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Authenticating...</p>
      </div>
    </div>
  );
}

/**
 * Client-side auth callback handler.
 *
 * Handles TWO Supabase auth flows:
 * 1. PKCE flow: ?code= in query params (magic links for existing users)
 * 2. Implicit flow: #access_token in hash fragment (confirmation emails for new users)
 *
 * Server-side route.ts CANNOT read hash fragments — that's why we need
 * a client-side page that runs in the browser.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AuthCallbackHandler />
    </Suspense>
  );
}

function AuthCallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processed = useRef(false);
  const supabase = createClient();

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    handleCallback();
  }, []);

  async function finalizeRedirect(
    user: { created_at: string; last_sign_in_at?: string | null; user_metadata?: any },
    next: string
  ) {
    await supabase.auth.getSession();
    const redirect = await getInviteSetupRedirect(user, next);
    if (redirect) {
      router.replace(redirect);
      router.refresh();
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function handleCallback() {
    const next = searchParams.get("next") || "/workspaces";
    const code = searchParams.get("code");

    // ── Flow 1: PKCE — ?code= in query params ──
    // Must use client-side exchange so the PKCE code verifier stored in the
    // browser is accessible. Server-side exchange fails with "invalid flow state".
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data?.user) {
        await finalizeRedirect(data.user, next);
        return;
      }
      console.error("[auth/callback] Code exchange failed:", error?.message);
      router.replace(`/login?error=auth_callback_error`);
      return;
    }

    // ── Flow 2: Implicit — #access_token in hash fragment ──
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error, data } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error && data?.user) {
          await finalizeRedirect(data.user, next);
          return;
        }
        console.error("[auth/callback] Session set failed:", error?.message);
      }
    }

    // ── Flow 3: token_hash (PKCE email confirmation) ──
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    if (tokenHash && type) {
      const { error, data } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as any,
      });
      if (!error && data?.user) {
        await finalizeRedirect(data.user, next);
        return;
      }
      console.error("[auth/callback] verifyOtp failed:", error?.message);
    }

    // No valid auth data found
    router.replace(`/login?error=auth_callback_error`);
  }

  /**
   * If the user is navigating to an invite page and this is their first sign-in
   * (new user created via invite), redirect to the setup page.
   */
  async function getInviteSetupRedirect(
    user: { created_at: string; last_sign_in_at?: string | null; user_metadata?: any },
    next: string
  ): Promise<string | null> {
    const createdAt = new Date(user.created_at).getTime();
    const lastSignIn = user.last_sign_in_at
      ? new Date(user.last_sign_in_at).getTime()
      : 0;
    const isFirstSignIn = Math.abs(createdAt - lastSignIn) < 120000;
    if (!isFirstSignIn) return null;

    const inviteMatch = next.match(/^\/invite\/([a-zA-Z0-9]+)$/);
    if (inviteMatch) {
      return `/invite/${inviteMatch[1]}/setup`;
    }

    try {
      const res = await fetch("/api/team/pending-invites", { cache: "no-store" });
      const json = await res.json();
      const pendingInvite = json?.invites?.[0];
      if (res.ok && pendingInvite?.token) {
        return `/invite/${pendingInvite.token}/setup`;
      }
    } catch {
      return null;
    }

    return null;
  }

  return <LoadingSpinner />;
}
