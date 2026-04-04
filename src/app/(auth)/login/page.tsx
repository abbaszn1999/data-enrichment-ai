"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Mail, Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { signIn, signInWithGoogle } from "@/lib/auth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/workspaces";
  const prefillEmail = searchParams.get("email") || "";
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Detect auth errors from callback redirect or hash fragment
  const urlError = searchParams.get("error");
  const [error, setError] = useState(() => {
    if (urlError === "auth_callback_error") {
      // Check hash fragment for more details (runs client-side)
      if (typeof window !== "undefined") {
        const hash = window.location.hash;
        if (hash.includes("otp_expired")) {
          return "The invite link has expired. Please ask the workspace owner to resend the invite.";
        }
        if (hash.includes("access_denied")) {
          return "Access denied. The link may be invalid or expired.";
        }
      }
      return "Authentication failed. Please try signing in manually.";
    }
    return "";
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password);
      window.location.href = redirect;
    } catch (err: any) {
      setError(err?.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setGoogleLoading(true);
    try {
      await signInWithGoogle(redirect);
    } catch (err: any) {
      setError(err?.message || "Failed to sign in with Google");
      setGoogleLoading(false);
    }
  };

  return (
    <Card className="p-6 space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to your account
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Button type="button" variant="outline" className="w-full h-10 gap-2" onClick={handleGoogleSignIn} disabled={loading || googleLoading}>
        {googleLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.4 14.7 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12S6.8 21.5 12 21.5c6.1 0 9.1-4.3 9.1-6.5 0-.4 0-.7-.1-1H12Z" />
            <path fill="#34A853" d="M2.5 12c0 1.8.6 3.5 1.7 4.8l3-2.3c-.4-.7-.7-1.6-.7-2.5s.2-1.8.7-2.5l-3-2.3C3.1 8.5 2.5 10.2 2.5 12Z" />
            <path fill="#4A90E2" d="M12 21.5c2.7 0 4.9-.9 6.5-2.4l-3.2-2.5c-.9.6-2 1-3.3 1-2.6 0-4.9-1.8-5.7-4.2l-3 2.3c1.6 3.3 5 5.8 8.7 5.8Z" />
            <path fill="#FBBC05" d="M6.3 13.4c-.2-.4-.3-.9-.3-1.4s.1-1 .3-1.4l-3-2.3C2.8 9.4 2.5 10.7 2.5 12s.3 2.6.8 3.7l3-2.3Z" />
          </svg>
        )}
        Continue with Google
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs font-medium">
            Email
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9 h-10"
              autoComplete="email"
              autoFocus
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs font-medium">
              Password
            </Label>
            <Link
              href="/reset-password"
              className="text-xs text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9 h-10"
              autoComplete="current-password"
            />
          </div>
        </div>

        <Button type="submit" className="w-full h-10" disabled={loading || googleLoading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Sign In
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href={`/register${redirect !== "/workspaces" ? `?redirect=${encodeURIComponent(redirect)}` : ""}`} className="text-primary font-medium hover:underline">
          Create account
        </Link>
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
      <LoginForm />
    </Suspense>
  );
}
