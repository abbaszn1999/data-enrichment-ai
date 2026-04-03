"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2, Lock, User, Building2, AlertCircle, CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase-browser";

export default function InviteSetupPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<any>(null);
  const [userEmail, setUserEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      const supabase = createClient();

      // 1. Check if user has a valid session (from the invite email link)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        // No session — they need to click the invite email link first
        setError("NO_SESSION");
        setLoading(false);
        return;
      }

      setUserEmail(session.user.email || "");
      setFullName(session.user.user_metadata?.full_name || "");

      // 2. Load invite details
      try {
        const res = await fetch(`/api/team/invite-lookup?token=${token}`);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || "Invalid invite.");
          setLoading(false);
          return;
        }
        setInvite({ ...json.invite, workspaces: json.workspace });
      } catch {
        setError("Failed to load invite details.");
      }

      setLoading(false);
    }

    init();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();

      // 1. Set the password for this invited user
      const updateData: any = { password };
      if (fullName.trim()) {
        updateData.data = { full_name: fullName.trim() };
      }
      const { error: updateErr } = await supabase.auth.updateUser(updateData);
      if (updateErr) throw updateErr;

      // 2. Accept the invite via server API
      const res = await fetch("/api/team/invite-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId: invite.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to accept invite");

      setWorkspaceSlug(invite.workspaces?.slug || "");
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Card>
    );
  }

  // No session — user needs to click the email link first
  if (error === "NO_SESSION") {
    return (
      <Card className="p-8 flex flex-col items-center gap-4 text-center max-w-md mx-auto">
        <Mail className="h-10 w-10 text-primary" />
        <h2 className="text-lg font-bold">Check Your Email</h2>
        <p className="text-sm text-muted-foreground">
          We sent you an invitation email. Click the link in that email to set up your account and join the workspace.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          If you don&apos;t see the email, check your spam folder.
        </p>
      </Card>
    );
  }

  if (success) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-600" />
        <h2 className="text-lg font-bold">You&apos;re all set!</h2>
        <p className="text-sm text-muted-foreground">
          Your account is ready and you&apos;ve joined <strong>{invite?.workspaces?.name}</strong>.
        </p>
        <Button className="mt-2" onClick={() => router.push(workspaceSlug ? `/w/${workspaceSlug}` : "/workspaces")}>
          Go to Workspace
        </Button>
      </Card>
    );
  }

  if (error && error !== "NO_SESSION") {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h2 className="text-lg font-bold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-6 max-w-md mx-auto">
      <div className="flex flex-col items-center gap-3 text-center">
        <Building2 className="h-10 w-10 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Set Up Your Account</h1>
          {invite && (
            <p className="text-sm text-muted-foreground mt-1">
              Join <strong>{invite.workspaces?.name}</strong> as <strong>{invite.role}</strong>
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email — locked, pre-filled */}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs font-medium">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              value={userEmail}
              disabled
              className="pl-9 h-10 bg-muted/50 cursor-not-allowed"
            />
          </div>
        </div>

        {/* Full Name */}
        <div className="space-y-2">
          <Label htmlFor="name" className="text-xs font-medium">Full Name</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="name"
              type="text"
              placeholder="Your name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="pl-9 h-10"
              autoFocus
            />
          </div>
        </div>

        {/* Password */}
        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs font-medium">
            Password <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              placeholder="Min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9 h-10"
              autoComplete="new-password"
            />
          </div>
        </div>

        {/* Confirm Password */}
        <div className="space-y-2">
          <Label htmlFor="confirm" className="text-xs font-medium">
            Confirm Password <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="confirm"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-9 h-10"
              autoComplete="new-password"
            />
          </div>
        </div>

        {error && error !== "NO_SESSION" && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Button type="submit" className="w-full h-10" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Join Workspace
        </Button>
      </form>
    </Card>
  );
}
