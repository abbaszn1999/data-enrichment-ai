"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { PageLoader } from "@/components/brand/page-loader";
import { fetchNeedsAccountSetup, inviteRedirectAfterAuth } from "@/lib/team/account-setup";

function LoadingSpinner() {
  return <PageLoader label="Authenticating..." className="min-h-screen" />;
}

function safeAuthNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/workspaces";
  return raw;
}

/**
 * Client-side auth callback handler.
 *
 * Handles TWO Supabase auth flows:
 * 1. PKCE flow: ?code= in query params (magic links / email confirmation)
 * 2. Implicit flow: #access_token in hash fragment (older confirmation emails)
 *
 * createBrowserClient auto-exchanges ?code= during initialize. This page must
 * wait for that session first — a second exchangeCodeForSession fails and used
 * to dump confirmed users on /login?error=auth_callback_error.
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

  async function finalizeRedirect(next: string) {
    await supabase.auth.getSession();
    const redirect = await getInviteSetupRedirect(next);
    if (redirect) {
      router.replace(redirect);
      router.refresh();
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function continueIfSession(next: string): Promise<boolean> {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) return false;
    await finalizeRedirect(next);
    return true;
  }

  function redirectToLoginWithError(next: string) {
    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    const hashParams = hash ? new URLSearchParams(hash) : null;
    const errorCode =
      searchParams.get("error_code") || hashParams?.get("error_code") || "";
    const params = new URLSearchParams({ error: "auth_callback_error" });
    if (errorCode) params.set("error_code", errorCode);
    if (next && next !== "/workspaces") params.set("redirect", next);
    router.replace(`/login?${params.toString()}`);
  }

  async function handleCallback() {
    const next = safeAuthNextPath(searchParams.get("next"));
    const code = searchParams.get("code");

    // Supabase rejected the link before any ?code= arrived (expired/consumed
    // OTP, denied access, etc). Surface the real reason instead of a generic
    // "authentication failed" and keep the invite path so the user can retry.
    const topLevelError = searchParams.get("error");
    if (topLevelError) {
      console.error("[auth/callback] Supabase returned an error:", topLevelError, searchParams.get("error_code"));
      if (await continueIfSession(next)) return;
      redirectToLoginWithError(next);
      return;
    }

    // PKCE client may already have exchanged ?code= during initialize.
    if (await continueIfSession(next)) return;

    // ── Flow 1: PKCE — ?code= in query params ──
    // Must use client-side exchange so the PKCE code verifier stored in the
    // browser is accessible. Server-side exchange fails with "invalid flow state".
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data?.user) {
        await finalizeRedirect(next);
        return;
      }
      console.error("[auth/callback] Code exchange failed:", error?.message);
      if (await continueIfSession(next)) return;
      redirectToLoginWithError(next);
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
          await finalizeRedirect(next);
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
        type: type as "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email",
      });
      if (!error && data?.user) {
        await finalizeRedirect(next);
        return;
      }
      console.error("[auth/callback] verifyOtp failed:", error?.message);
    }

    if (await continueIfSession(next)) return;
    redirectToLoginWithError(next);
  }

  /**
   * Invite magic links land on /invite/{token}. Setup (password) is only for
   * emails that do not already have a completed account.
   */
  async function getInviteSetupRedirect(next: string): Promise<string | null> {
    const needsAccountSetup = await fetchNeedsAccountSetup();

    let pendingInviteToken: string | null = null;
    if (needsAccountSetup) {
      try {
        const res = await fetch("/api/team/pending-invites", { cache: "no-store" });
        const json = await res.json();
        pendingInviteToken = res.ok ? json?.invites?.[0]?.token ?? null : null;
      } catch {
        pendingInviteToken = null;
      }
    }

    return inviteRedirectAfterAuth(next, needsAccountSetup, pendingInviteToken);
  }

  return <LoadingSpinner />;
}
