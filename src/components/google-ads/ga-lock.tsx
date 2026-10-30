"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The Google Ads prototype is open to people given its password. */
export function GoogleAdsLock() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || checking) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/google-ads/preview-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not check the password.");
      setPassword("");
    } catch {
      setError("Could not check the password.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
            <Megaphone className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[15px] font-semibold leading-tight">Google Ads</h1>
            <p className="text-[12px] text-muted-foreground">Preview: enter the password to open it.</p>
          </div>
        </div>
        <label htmlFor="ga-password" className="mb-1.5 block text-[12px] font-medium">
          Password
        </label>
        <div className="relative">
          <Lock className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            id="ga-password"
            type="password"
            autoFocus
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 w-full rounded-lg border bg-background ps-9 pe-3 text-[14px] outline-none focus:ring-2 focus:ring-[#6B358D]/25 dark:focus:ring-[#F76D01]/25"
          />
        </div>
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        <Button
          type="submit"
          disabled={!password || checking}
          className="mt-4 h-10 w-full rounded-lg bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Open"}
        </Button>
      </form>
    </div>
  );
}
