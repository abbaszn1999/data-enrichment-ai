"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Lock,
  Building2,
  AlertCircle,
  Mail,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { PageLoader } from "@/components/brand/page-loader";
import { createClient } from "@/lib/supabase-browser";
import { displayNameFromEmail, fetchNeedsAccountSetup } from "@/lib/team/account-setup";

function destinationFromAccept(json: { workspaceSlug?: string | null }, fallbackSlug?: string) {
  const slug = json.workspaceSlug || fallbackSlug;
  return slug ? `/w/${slug}` : "/workspaces";
}

export default function InviteSetupPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<any>(null);
  const [userEmail, setUserEmail] = useState("");
  const [inferredName, setInferredName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setFatalError("NO_SESSION");
        setLoading(false);
        return;
      }

      const email = session.user.email || "";
      setUserEmail(email);
      const existingName =
        typeof session.user.user_metadata?.full_name === "string"
          ? session.user.user_metadata.full_name.trim()
          : "";
      setInferredName(existingName || displayNameFromEmail(email));

      try {
        const [lookupRes, needsAccountSetup] = await Promise.all([
          fetch(`/api/team/invite-lookup?token=${token}`),
          fetchNeedsAccountSetup(),
        ]);
        const json = await lookupRes.json();

        if (!lookupRes.ok) {
          setFatalError(json.error || "Invalid invite.");
          setLoading(false);
          return;
        }

        const inviteEmail = String(json.invite?.email || "").toLowerCase();
        if (inviteEmail && email.toLowerCase() && inviteEmail !== email.toLowerCase()) {
          router.replace(`/invite/${token}`);
          return;
        }

        if (!needsAccountSetup) {
          router.replace(`/invite/${token}`);
          return;
        }

        setInvite({ ...json.invite, workspaces: json.workspace });
      } catch {
        setFatalError("Failed to load invite details.");
      }

      setLoading(false);
    }

    init();
  }, [token, router]);

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const passwordReady = password.length >= 6 && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!password || !confirmPassword) {
      setFormError("Enter and confirm your password");
      return;
    }
    if (password.length < 6) {
      setFormError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      if (!invite?.id) throw new Error("Invite is not available");
      const supabase = createClient();
      const updateData: {
        password: string;
        data: { full_name?: string; password_set: true };
      } = {
        password,
        data: { password_set: true },
      };
      if (inferredName) {
        updateData.data.full_name = inferredName;
      }
      const { error: updateErr } = await supabase.auth.updateUser(updateData);
      if (updateErr) throw updateErr;

      const res = await fetch("/api/team/invite-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteId: invite.id,
          fullName: inferredName || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to accept invite");

      window.location.href = destinationFromAccept(json, invite.workspaces?.slug);
    } catch (err: any) {
      setFormError(err?.message || "Something went wrong");
      setSubmitting(false);
    }
  };

  if (loading || submitting) {
    return (
      <Card className="p-8">
        <PageLoader
          label={submitting ? "Joining workspace..." : undefined}
          className="min-h-0 bg-transparent"
        />
      </Card>
    );
  }

  if (fatalError === "NO_SESSION") {
    return (
      <Card className="p-8 flex flex-col items-center gap-4 text-center max-w-md mx-auto">
        <Mail className="h-10 w-10 text-primary" />
        <h2 className="text-lg font-bold">Open your invitation email</h2>
        <p className="text-sm text-muted-foreground">
          Click the link we sent you to confirm this email, set a password, and join the workspace.
        </p>
        <p className="text-xs text-muted-foreground">
          If you don&apos;t see it, check spam or ask the workspace owner to resend.
        </p>
      </Card>
    );
  }

  if (fatalError) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h2 className="text-lg font-bold">This invite can&apos;t be used</h2>
        <p className="text-sm text-muted-foreground">{fatalError}</p>
      </Card>
    );
  }

  const workspaceName = invite?.workspaces?.name || "the workspace";
  const mismatchHint =
    confirmPassword.length > 0 && password !== confirmPassword
      ? "Passwords do not match"
      : "";

  return (
    <Card className="p-6 space-y-6 max-w-md mx-auto">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/10">
          <Building2 className="h-6 w-6 text-[#6B358D] dark:text-[#F76D01]" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Create your password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Join <strong>{workspaceName}</strong>
            {invite?.role ? (
              <>
                {" "}
                as <strong className="capitalize">{invite.role}</strong>
              </>
            ) : null}
            . Then you&apos;ll go straight in.
          </p>
        </div>
        {userEmail && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            {userEmail}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs font-medium">
            Password
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 pl-9 pr-10"
              autoComplete="new-password"
              autoFocus
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((open) => !open)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm" className="text-xs font-medium">
            Confirm password
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="confirm"
              type={showConfirm ? "text" : "password"}
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-10 pl-9 pr-10"
              autoComplete="new-password"
            />
            <button
              type="button"
              aria-label={showConfirm ? "Hide password" : "Show password"}
              onClick={() => setShowConfirm((open) => !open)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {mismatchHint && (
            <p className="text-[11px] text-destructive">{mismatchHint}</p>
          )}
        </div>

        {formError && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {formError}
          </div>
        )}

        <Button
          type="submit"
          className="h-10 w-full rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
          disabled={submitting || !passwordReady}
        >
          Join {workspaceName}
        </Button>
      </form>
    </Card>
  );
}
