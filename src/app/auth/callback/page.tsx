"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

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

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    handleCallback();
  }, []);

  async function handleCallback() {
    const next = searchParams.get("next") || "/workspaces";
    const code = searchParams.get("code");

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { flowType: "pkce" } }
    );

    // ── Flow 1: PKCE — ?code= in query params ──
    if (code) {
      const { error, data } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data?.user) {
        const redirect = getInviteSetupRedirect(data.user, next);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        router.replace(next);
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
          const redirect = getInviteSetupRedirect(data.user, next);
          if (redirect) {
            router.replace(redirect);
            return;
          }
          router.replace(next);
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
        const redirect = getInviteSetupRedirect(data.user, next);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        router.replace(next);
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
  function getInviteSetupRedirect(
    user: { created_at: string; last_sign_in_at?: string | null; user_metadata?: any },
    next: string
  ): string | null {
    const inviteMatch = next.match(/^\/invite\/([a-zA-Z0-9]+)$/);
    if (!inviteMatch) return null;

    const createdAt = new Date(user.created_at).getTime();
    const lastSignIn = user.last_sign_in_at
      ? new Date(user.last_sign_in_at).getTime()
      : 0;
    const isFirstSignIn = Math.abs(createdAt - lastSignIn) < 120000;
    const hasNoPassword = !user.user_metadata?.full_name;

    if (isFirstSignIn && hasNoPassword) {
      return `/invite/${inviteMatch[1]}/setup`;
    }
    return null;
  }

  return <LoadingSpinner />;
}
