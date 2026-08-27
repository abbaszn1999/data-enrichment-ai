"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { AutommerceLogo } from "@/components/brand/autommerce-logo";
import { PageLoader } from "@/components/brand/page-loader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_STAFF } from "@/lib/platform-admin/config";
import { adminRoutes } from "@/lib/platform-admin/paths";
import { fetchAdminSession, loginAdmin } from "@/lib/platform-admin/session";

export function AdminLoginForm() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string>(ADMIN_STAFF.email);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAdminSession().then((ok) => {
      if (cancelled) return;
      if (ok) {
        router.replace(adminRoutes.overview());
        return;
      }
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return <PageLoader label="Opening platform" className="min-h-screen" />;
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Enter email and password.");
      return;
    }
    setLoading(true);
    const result = await loginAdmin(email, password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace(adminRoutes.overview());
  };

  return (
    <div className="autommerce-dashboard flex min-h-screen flex-col items-center justify-center bg-background p-4 [font-family:var(--brand-font)]">
      <div className="mb-6 flex items-center gap-2">
        <AutommerceLogo size={28} priority />
        <span className="text-lg font-semibold tracking-tight">Autommerce</span>
        <span className="rounded-md bg-[#400095]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#400095] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
          Platform
        </span>
      </div>

      <Card className="w-full max-w-sm gap-0 p-6">
        <div className="mb-5 space-y-1 text-center">
          <h1 className="text-xl font-semibold">Platform sign in</h1>
          <p className="text-sm text-muted-foreground">
            Staff access to live users, billing, jobs, and workspaces.
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-email" className="text-xs">
              Email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-10 pl-9"
                autoComplete="username"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password" className="text-xs">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 pl-9 pr-10"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="h-10 w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
