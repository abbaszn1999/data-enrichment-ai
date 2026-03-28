"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, AlertCircle, Building2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

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
  const acceptAttempted = useRef(false);

  // Step 1: Load invite via API route (bypasses RLS issues for non-members)
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
      } catch (err: any) {
        console.error("[Invite] unexpected error:", err);
        setError("Something went wrong. Please try again.");
      }
      setLoading(false);
    }

    loadInvite();
  }, [token]);

  // Step 2: Once invite loaded + session confirmed + user exists → accept via server API
  useEffect(() => {
    if (!invite || !sessionReady || !user || success || acceptAttempted.current) return;

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

  // Not logged in — show login/register prompt with context
  return (
    <Card className="p-8 flex flex-col items-center gap-4 text-center max-w-md mx-auto">
      <Building2 className="h-10 w-10 text-primary" />
      <h2 className="text-lg font-bold">Workspace Invite</h2>
      {invite && (
        <p className="text-sm text-muted-foreground">
          You&apos;ve been invited to join <strong>{invite.workspaces?.name}</strong> as <strong>{invite.role}</strong>.
        </p>
      )}
      <div className="w-full space-y-3 mt-2">
        <p className="text-xs text-muted-foreground">
          Sign in to your existing account or create a new one to accept this invite.
        </p>
        <Link href={`/login?redirect=/invite/${token}`} className="block">
          <Button className="w-full">Sign In</Button>
        </Link>
        <Link href={`/register?redirect=/invite/${token}`} className="block">
          <Button variant="outline" className="w-full">Create Account</Button>
        </Link>
      </div>
      <div className="flex items-center gap-2 mt-2 p-3 rounded-lg bg-muted/50 w-full">
        <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <p className="text-[11px] text-muted-foreground text-left">
          If you received a magic link or invite email, click the link in that email to sign in automatically.
        </p>
      </div>
    </Card>
  );
}
