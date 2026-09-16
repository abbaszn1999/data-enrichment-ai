"use client";

import { useEffect, useState } from "react";
import { Gift, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWelcomeGiftRemaining } from "@/hooks/use-welcome-gift-remaining";
import {
  isWelcomeGiftOpen,
  type WelcomeGiftState,
} from "@/lib/billing/welcome-gift";
import { formatCredits } from "@/lib/format-credits";
import { useWorkspaceStore } from "@/store/workspace-store";

export function WelcomeGiftCard({
  workspaceId,
  gift,
}: {
  workspaceId: string;
  gift: WelcomeGiftState;
}) {
  const remaining = useWelcomeGiftRemaining(gift.expiresAt);
  const invalidateCredits = useWorkspaceStore((s) => s.invalidateCredits);
  const invalidateSubscription = useWorkspaceStore((s) => s.invalidateSubscription);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const open = !claimed && isWelcomeGiftOpen(gift) && remaining !== null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#welcome-gift") return;
    document.getElementById("welcome-gift")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  if (!open || !remaining) return null;

  const creditsLabel = formatCredits(gift.credits);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const res = await fetch("/api/subscription/welcome-gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        ok?: boolean;
      } | null;
      if (!res.ok) {
        if (res.status === 409) {
          setClaimed(true);
          invalidateCredits();
          invalidateSubscription();
          return;
        }
        toast.error(data?.error || "Could not claim the gift");
        return;
      }
      setClaimed(true);
      invalidateCredits();
      invalidateSubscription();
      toast.success(`${creditsLabel} bonus credits added to your balance`);
    } catch {
      toast.error("Could not claim the gift");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div
      id="welcome-gift"
      className="relative scroll-mt-20 overflow-hidden rounded-2xl border-2 border-[#C40000]/25 bg-gradient-to-br from-[#C40000]/[0.08] via-background to-[#400095]/[0.07] p-5 sm:p-7"
    >
      <div className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-[#C40000]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-[#400095]/10 blur-3xl" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#C40000]/15">
            <Gift className="h-5 w-5 text-[#C40000]" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#C40000] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                Live
              </span>
              <h2 className="text-lg font-bold leading-tight">
                Welcome gift · {creditsLabel} credits
              </h2>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              First Growth or Pro subscription bonus. Claim within{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {remaining}
              </span>
              . Added once to your bonus balance — it never renews.
            </p>
          </div>
        </div>

        <Button
          className="h-10 shrink-0 gap-1.5 bg-[#C40000] font-semibold text-white hover:bg-[#a40000]"
          onClick={() => void handleClaim()}
          disabled={claiming}
        >
          {claiming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Claim {creditsLabel} credits
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
