"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { PageLoader } from "@/components/brand/page-loader";
import { fetchNeedsAccountSetup, inviteRedirectAfterAuth } from "@/lib/team/account-setup";

const LOG = "[auth/callback]";

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
 * Handles THREE Supabase auth delivery mechanisms:
 * 1. PKCE flow: ?code= in query params (magic links / email confirmation)
 * 2. Implicit flow: #access_token in hash fragment (older confirmation emails)
 * 3. token_hash flow: ?token_hash=&type= (custom email templates)
 *
 * IMPORTANT: `detectSessionInUrl` is disabled on the browser client (see
 * lib/supabase-browser.ts) specifically so this page is the ONLY place that
 * ever consumes ?code=/token_hash=. That avoids a race where the SDK's own
 * auto-detection and our explicit exchange both try to consume the same
 * one-time code, and avoids ever trusting a session that happened to already
 * be sitting in the browser (e.g. an admin testing invites in the same
 * browser they're logged into) instead of the one the link is actually for.
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

    handleCallback().catch((err) => {
      console.error(`${LOG} unhandled error in handleCallback:`, err);
      redirectToLoginWithError(safeAuthNextPath(searchParams.get("next")));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finalizeRedirect(next: string, userEmail?: string | null) {
    console.log(`${LOG} finalizeRedirect: authenticated as`, userEmail, "next=", next);
    const redirect = await getInviteSetupRedirect(next);
    if (redirect) {
      console.log(`${LOG} redirecting (invite setup logic) →`, redirect);
      router.replace(redirect);
      router.refresh();
      return;
    }
    console.log(`${LOG} redirecting →`, next);
    router.replace(next);
    router.refresh();
  }

  function redirectToLoginWithError(next: string) {
    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    const hashParams = hash ? new URLSearchParams(hash) : null;
    const errorCode =
      searchParams.get("error_code") || hashParams?.get("error_code") || "";
    console.log(`${LOG} redirectToLoginWithError: error_code=`, errorCode || "(none)", "next=", next);
    const params = new URLSearchParams({ error: "auth_callback_error" });
    if (errorCode) params.set("error_code", errorCode);
    if (next && next !== "/workspaces") params.set("redirect", next);
    router.replace(`/login?${params.toString()}`);
  }

  /**
   * Checks the *expected* email (passed through by our own invite/signup
   * senders as `?email=`) against whatever email actually landed in the
   * session. Returns true if there's no mismatch (or nothing to check).
   */
  function emailMatchesExpectation(actualEmail: string | null | undefined): boolean {
    const expected = searchParams.get("email");
    if (!expected) return true;
    const matches = !!actualEmail && actualEmail.toLowerCase() === expected.toLowerCase();
    if (!matches) {
      console.warn(
        `${LOG} email mismatch: expected`,
        expected,
        "but session belongs to",
        actualEmail
      );
    }
    return matches;
  }

  async function handleCallback() {
    const next = safeAuthNextPath(searchParams.get("next"));
    const code = searchParams.get("code");
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    const hash = window.location.hash;
    const hasImplicitToken = !!hash && hash.includes("access_token");
    const hasAuthPayload = !!code || !!(tokenHash && type) || hasImplicitToken;

    console.log(`${LOG} start`, {
      next,
      hasCode: !!code,
      tokenHash: tokenHash ? "present" : null,
      type,
      hasImplicitToken,
      expectedEmail: searchParams.get("email"),
      url: window.location.href,
    });

    // Supabase rejected the link before any ?code=/token_hash arrived
    // (expired/consumed OTP, denied access, etc). Surface the real reason
    // instead of a generic "authentication failed".
    const topLevelError = searchParams.get("error");
    if (topLevelError) {
      console.error(
        `${LOG} Supabase returned a top-level error:`,
        topLevelError,
        searchParams.get("error_code"),
        searchParams.get("error_description")
      );
      redirectToLoginWithError(next);
      return;
    }

    if (!hasAuthPayload) {
      // No code/token in this URL at all (page reload, back button after a
      // completed callback, etc). Only NOW is it safe to trust whatever
      // session already exists in the browser.
      console.log(`${LOG} no auth payload in URL — checking existing session`);
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        console.log(`${LOG} existing session found for`, data.session.user.email);
        await finalizeRedirect(next, data.session.user.email);
        return;
      }
      console.warn(`${LOG} no auth payload and no existing session — bailing to login`);
      redirectToLoginWithError(next);
      return;
    }

    // A code/token is present — this link is for a specific identity. Clear
    // any session already sitting in this browser FIRST so the exchange
    // below can never be shadowed by (or confused with) a stale/unrelated
    // one — e.g. a workspace owner testing an invite in the same browser
    // they're signed into.
    const { data: preExisting } = await supabase.auth.getSession();
    if (preExisting.session?.user) {
      console.log(
        `${LOG} clearing pre-existing session (${preExisting.session.user.email}) before consuming this link`
      );
      await supabase.auth.signOut({ scope: "local" });
    }

    // ── Flow 1: PKCE — ?code= in query params ──
    if (code) {
      console.log(`${LOG} exchanging PKCE code for a session...`);
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data?.user) {
        console.log(`${LOG} code exchange succeeded for`, data.user.email);
        if (!emailMatchesExpectation(data.user.email)) {
          await supabase.auth.signOut({ scope: "local" });
          redirectToLoginWithError(next);
          return;
        }
        await finalizeRedirect(next, data.user.email);
        return;
      }
      console.error(`${LOG} code exchange failed:`, error?.message);
      redirectToLoginWithError(next);
      return;
    }

    // ── Flow 2: Implicit — #access_token in hash fragment ──
    if (hasImplicitToken) {
      console.log(`${LOG} setting session from implicit hash tokens...`);
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error, data } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error && data?.user) {
          console.log(`${LOG} implicit session set succeeded for`, data.user.email);
          if (!emailMatchesExpectation(data.user.email)) {
            await supabase.auth.signOut({ scope: "local" });
            redirectToLoginWithError(next);
            return;
          }
          await finalizeRedirect(next, data.user.email);
          return;
        }
        console.error(`${LOG} implicit session set failed:`, error?.message);
      } else {
        console.error(`${LOG} implicit hash present but missing access/refresh token`);
      }
      redirectToLoginWithError(next);
      return;
    }

    // ── Flow 3: token_hash (custom email templates) ──
    if (tokenHash && type) {
      console.log(`${LOG} verifying OTP token_hash (type=${type})...`);
      const { error, data } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email",
      });
      if (!error && data?.user) {
        console.log(`${LOG} verifyOtp succeeded for`, data.user.email);
        if (!emailMatchesExpectation(data.user.email)) {
          await supabase.auth.signOut({ scope: "local" });
          redirectToLoginWithError(next);
          return;
        }
        await finalizeRedirect(next, data.user.email);
        return;
      }
      console.error(`${LOG} verifyOtp failed:`, error?.message);
      redirectToLoginWithError(next);
      return;
    }

    console.warn(`${LOG} reached end of handleCallback with no matching flow`);
    redirectToLoginWithError(next);
  }

  /**
   * Invite magic links land on /invite/{token}. Setup (password) is only for
   * emails that do not already have a completed account.
   */
  async function getInviteSetupRedirect(next: string): Promise<string | null> {
    const needsAccountSetup = await fetchNeedsAccountSetup();
    console.log(`${LOG} getInviteSetupRedirect: needsAccountSetup=`, needsAccountSetup);

    let pendingInviteToken: string | null = null;
    if (needsAccountSetup) {
      try {
        const res = await fetch("/api/team/pending-invites", { cache: "no-store" });
        const json = await res.json();
        pendingInviteToken = res.ok ? json?.invites?.[0]?.token ?? null : null;
        console.log(`${LOG} pendingInviteToken=`, pendingInviteToken);
      } catch (err) {
        console.error(`${LOG} pending-invites lookup failed:`, err);
        pendingInviteToken = null;
      }
    }

    return inviteRedirectAfterAuth(next, needsAccountSetup, pendingInviteToken);
  }

  return <LoadingSpinner />;
}
