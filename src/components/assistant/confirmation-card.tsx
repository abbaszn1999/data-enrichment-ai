"use client";

import { useEffect, useState } from "react";
import { Coins, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCredits } from "@/lib/format-credits";
import { useSheetStore } from "@/store/sheet-store";
import { getPageHandlers } from "@/lib/assistant/driver/page-handlers";
import type { PendingConfirmation } from "@/hooks/use-assistant-stream";

type Estimate = { min: number; max: number } | null;

/** Shown before the assistant spends credits. Approving unlocks exactly one click on exactly one control. */
export function ConfirmationCard({
  confirmation,
  workspaceId,
  onDecide,
}: {
  confirmation: PendingConfirmation;
  workspaceId: string;
  onDecide: (approved: boolean) => void;
}) {
  const [estimate, setEstimate] = useState<Estimate>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const scope = confirmation.actionTarget.startsWith("gallery.")
      ? "gallery"
      : confirmation.actionTarget.startsWith("visualizer.")
        ? "visualizer"
        : null;
    const pageEstimate = scope ? getPageHandlers(scope)?.estimate?.() : null;
    const feature = pageEstimate?.feature ?? "catalog";
    const rows = Math.max(1, pageEstimate ? pageEstimate.rows : useSheetStore.getState().selectedRowIds.size || 1);
    fetch(`/api/assistant/estimate?workspaceId=${encodeURIComponent(workspaceId)}&rows=${rows}&feature=${feature}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        setEstimate(data.estimate ?? null);
        setBalance(typeof data.balance === "number" ? data.balance : null);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [workspaceId, confirmation.callId]);

  return (
    <div className="mx-3 mb-2 rounded-xl border border-[#F76D01]/40 bg-[#F76D01]/5 p-3 text-xs">
      <div className="mb-1 flex items-center gap-1.5 font-semibold">
        <ShieldCheck className="h-3.5 w-3.5 text-[#F76D01]" /> {confirmation.title}
      </div>
      <ul className="mb-2 space-y-0.5 text-muted-foreground">
        {confirmation.details.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
      <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-background/70 px-2 py-1.5">
        <Coins className="h-3.5 w-3.5 text-muted-foreground" />
        {!loaded ? (
          <span className="text-muted-foreground">Estimating cost…</span>
        ) : estimate ? (
          <span>
            Estimated <strong>{formatCredits(estimate.min)}–{formatCredits(estimate.max)}</strong> credits
            {balance !== null && <span className="text-muted-foreground"> · balance {formatCredits(balance)}</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">
            Cost depends on the rows and columns, charged at actual usage
            {balance !== null && ` · balance ${formatCredits(balance)}`}
          </span>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onDecide(false)}>
          Cancel
        </Button>
        <Button size="sm" className="h-8 bg-[#400095] text-xs text-white hover:bg-[#6B358D]" onClick={() => onDecide(true)}>
          Approve and run
        </Button>
      </div>
    </div>
  );
}
