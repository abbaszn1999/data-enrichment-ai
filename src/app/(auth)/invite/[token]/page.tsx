"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Building2, Mail, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageLoader } from "@/components/brand/page-loader";
import { useAuth } from "@/hooks/use-auth";
import { signOut } from "@/lib/auth";

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  const { user, sessionReady } = useAuth();
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<any>(null);
  const [isExistingUser, setIsExistingUser] = useState(false);
  const [emailMismatch, setEmailMismatch] = useState(false);
  const acceptAttempted = useRef(false);

  // Step 1: Load invite via API route
  useEffect(() => {
    if (!token) return;

    async function loadInvite() {
      try {
        const res = await fetch(`/api/team/invite-lookup?token=${token}`);
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || "This invite is invalid or has expired.");
          setLoading(false);
          return;
        }

        setInvite({ ...json.invite, workspaces: json.workspace });
        setIsExistingUser(!!json.isExistingUser);
      } catch (err: any) {
        console.error("[Invite] unexpected error:", err);
        setError("Something went wrong. Please try again.");
      }
      setLoading(false);
    }

    loadInvite();
  }, [token]);

  // Step 2: If user is logged in + invite loaded → check email match, then accept
  useEffect(() => {
    if (!invite || !sessionReady || !user || acceptAttempted.current) return;

    // Check email mismatch
    const inviteEmail = invite.email?.toLowerCase();
    const userEmail = user.email?.toLowerCase();
    if (inviteEmail && userEmail && inviteEmail !== userEmail) {
      setEmailMismatch(true);
      return;
    }

    acceptAttempted.current = true;
    setAccepting(true);
    const inviteId = invite.id;

    async function joinOrSetup() {
      let keepLoader = false;
      try {
        const statusRes = await fetch("/api/team/account-setup-needed", {
          cache: "no-store",
        });
        const status = statusRes.ok
          ? await statusRes.json()
          : { needsAccountSetup: false };
        if (status.needsAccountSetup) {
          keepLoader = true;
          router.replace(`/invite/${token}/setup`);
          return;
        }

        const res = await fetch("/api/team/invite-accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteId }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to accept invite");
        const slug = json.workspaceSlug || invite.workspaces?.slug;
        keepLoader = true;
        window.location.href = slug ? `/w/${slug}` : "/workspaces";
      } catch (err: any) {
        setError(err?.message || "Failed to accept invite");
      } finally {
        if (!keepLoader) setAccepting(false);
      }
    }

    void joinOrSetup();
  }, [invite, user, sessionReady, router, token]);

  const handleSignOutAndRedirect = async () => {
    await signOut();
    window.location.href = `/login?redirect=/invite/${token}&email=${encodeURIComponent(invite?.email || "")}`;
  };

  if (loading || accepting) {
    return (
      <Card className="p-8">
        <PageLoader
          label={accepting ? "Accepting invite..." : "Loading invite..."}
          className="min-h-0 bg-transparent"
        />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h2 className="text-lg font-bold">Invalid Invite</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Link href="/login">
          <Button variant="outline" className="mt-2">Go to Login</Button>
        </Link>
      </Card>
    );
  }

  if (emailMismatch && user && invite) {
    return (
      <Card className="p-8 flex flex-col items-center gap-4 text-center max-w-md mx-auto">
        <AlertCircle className="h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-bold">Email Mismatch</h2>
        <p className="text-sm text-muted-foreground">
          This invite was sent to <strong>{invite.email}</strong>, but you&apos;re signed in as <strong>{user.email}</strong>.
        </p>
        <div className="w-full space-y-3 mt-2">
          <Button className="w-full gap-2" onClick={handleSignOutAndRedirect}>
            <LogOut className="h-4 w-4" />
            Sign out &amp; use {invite.email}
          </Button>
        </div>
      </Card>
    );
  }

  // Not logged in — show appropriate prompt based on whether user exists
  return (
    <Card className="p-8 flex flex-col items-center gap-4 text-center max-w-md mx-auto">
      <Building2 className="h-10 w-10 text-primary" />
      <h2 className="text-lg font-bold">Workspace Invite</h2>
      {invite && (
        <p className="text-sm text-muted-foreground">
          You&apos;ve been invited to join <strong>{invite.workspaces?.name}</strong> as <strong>{invite.role}</strong>.
        </p>
      )}

      {isExistingUser ? (
        // Existing user — we sent them a magic link, so tell them to check email first.
        // Also offer Sign In with password as a secondary option.
        <div className="w-full space-y-3 mt-2">
          <div className="flex items-center gap-2 p-4 rounded-lg bg-muted/50 w-full">
            <Mail className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="text-left">
              <p className="text-sm font-medium">Check your email</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                We sent a sign-in link to <strong>{invite?.email}</strong>. Click the link in that email to accept this invite.
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Don&apos;t see the email? Check your spam folder or ask the workspace owner to resend the invite.
          </p>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/50" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>
          <Link href={`/login?redirect=/invite/${token}&email=${encodeURIComponent(invite?.email || "")}`} className="block">
            <Button variant="outline" className="w-full text-sm">Sign in with password</Button>
          </Link>
        </div>
      ) : (
        // New user — tell them to check their email (inviteUserByEmail sent a link)
        <div className="w-full space-y-3 mt-2">
          <div className="flex items-center gap-2 p-4 rounded-lg bg-muted/50 w-full">
            <Mail className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="text-left">
              <p className="text-sm font-medium">Check your email</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                We sent an invitation link to <strong>{invite?.email}</strong>. Click it to create a password and join.
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Don&apos;t see the email? Check your spam folder or ask the workspace owner to resend the invite.
          </p>
        </div>
      )}
    </Card>
  );
}
