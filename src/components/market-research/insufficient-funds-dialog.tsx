"use client";

import Link from "next/link";
import { AlertCircle, ExternalLink, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatUsd } from "./mock-data";

export interface InsufficientFundsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requiredAmount: number;
  currentBalance: number | null;
  actionName?: string;
  walletHref?: string;
}

export function InsufficientFundsDialog({
  open,
  onOpenChange,
  requiredAmount,
  currentBalance,
  actionName = "Metered operation",
  walletHref = "/wallet",
}: InsufficientFundsDialogProps) {
  const balance = currentBalance ?? 0;
  const shortfall = Math.max(0, requiredAmount - balance);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold tracking-tight">
                Not Enough Wallet Balance
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Top up your workspace wallet to proceed with this run.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <div className="rounded-xl border border-border/70 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Operation</span>
              <span className="font-semibold text-foreground text-right">{actionName}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
              <span className="text-muted-foreground">Required amount</span>
              <span className="font-semibold text-foreground tabular-nums">
                {formatUsd(requiredAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
              <span className="text-muted-foreground">Current balance</span>
              <span className="font-semibold text-muted-foreground tabular-nums">
                {formatUsd(balance)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/50 pt-1.5 font-bold">
              <span className="text-destructive">Shortfall needed</span>
              <span className="text-destructive tabular-nums">
                {formatUsd(shortfall)}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
            <span>
              Runs are billed at exact API provider cost without markup. Top-up funds never expire and remain available for any future runs across your workspace.
            </span>
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Link href={walletHref} target="_blank" onClick={() => onOpenChange(false)}>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            >
              <Wallet className="h-3.5 w-3.5" />
              <span>Top Up Wallet</span>
              <ExternalLink className="h-3 w-3 opacity-70" />
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
