"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, AlertCircle, Building2, Mail, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  const [success, setSuccess] = useState(false);
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
    if (!invite || !sessionReady || !user || success || acceptAttempted.current) return;

    // Check email mismatch
    const inviteEmail = invite.email?.toLowerCase();
    const userEmail = user.email?.toLowerCase();
    if (inviteEmail && userEmail && inviteEmail !== userEmail) {
      setEmailMismatch(true);
      return;
    }

    acceptAttempted.current = true;
    setAccepting(true);
    fetch("/api/team/invite-accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId: invite.id }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to accept invite");
        setSuccess(true);
      })
      .catch((err: any) => setError(err?.message || "Failed to accept invite"))
      .finally(() => setAccepting(false));
  }, [invite, user, sessionReady, success]);

  const handleSignOutAndRedirect = async () => {
    await signOut();
    window.location.href = `/login?redirect=/invite/${token}&email=${encodeURIComponent(invite?.email || "")}`;
  };

  if (loading || accepting) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{accepting ? "Accepting invite..." : "Loading invite..."}</p>
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

  if (success && invite) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-600" />
        <h2 className="text-lg font-bold">You&apos;ve joined!</h2>
        <p className="text-sm text-muted-foreground">
          You are now a member of <strong>{invite.workspaces?.name}</strong> as <strong>{invite.role}</strong>.
        </p>
        <Button className="mt-2" onClick={() => router.push(`/w/${invite.workspaces?.slug}`)}>
          Go to Workspace
        </Button>
      </Card>
    );
  }

  // Logged in but email doesn't match the invite
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
        // Existing user — only show Sign In
        <div className="w-full space-y-3 mt-2">
          <p className="text-xs text-muted-foreground">
            Sign in with <strong>{invite?.email}</strong> to accept this invite.
          </p>
          <Link href={`/login?redirect=/invite/${token}&email=${encodeURIComponent(invite?.email || "")}`} className="block">
            <Button className="w-full">Sign In</Button>
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
                We sent an invitation link to <strong>{invite?.email}</strong>. Click the link in that email to set up your account and join the workspace.
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
