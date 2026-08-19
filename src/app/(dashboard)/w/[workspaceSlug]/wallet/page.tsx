"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Download,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Wallet as WalletIcon,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { useWallet, saveWalletAutoReloadApi, topUpWalletApi } from "@/hooks/use-wallet";
import { useWorkspace } from "@/hooks/use-workspace";
import { useWorkspaceStore } from "@/store/workspace-store";
import {
  PAYMENT_METHODS,
  TOPUP_PRESETS,
  formatMoney,
  spendByModule,
  spentSince,
  transactionsToCsv,
} from "@/lib/wallet/format";
import type { WalletTx } from "@/lib/wallet/types";
import { cn } from "@/lib/utils";

type TxFilter = "all" | "topup" | "charge";

const MODULE_TONE: Record<string, string> = {
  "Market Research":
    "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/25",
  "Market research":
    "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/25",
  Sync: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25",
  Billing:
    "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WalletPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { user } = useAuth();
  const { workspace } = useWorkspace(slug, user);
  const workspaceId = workspace?.id ?? "";
  const { wallet, isLoading } = useWallet(workspaceId || null);
  const invalidateWallet = useWorkspaceStore((s) => s.invalidateWallet);

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState<string>("100");
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0].id);
  const [processing, setProcessing] = useState(false);
  const [filter, setFilter] = useState<TxFilter>("all");
  const [query, setQuery] = useState("");

  const transactions = useMemo(() => {
    if (!wallet) return [] as WalletTx[];
    const q = query.trim().toLowerCase();
    return wallet.transactions.filter((tx) => {
      if (filter === "topup" && tx.amount < 0) return false;
      if (filter === "charge" && tx.amount >= 0) return false;
      if (!q) return true;
      return (
        tx.description.toLowerCase().includes(q) ||
        tx.module.toLowerCase().includes(q)
      );
    });
  }, [wallet, filter, query]);

  if (isLoading || !wallet) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const spent30 = spentSince(wallet, 30);
  const spent7 = spentSince(wallet, 7);
  const byModule = spendByModule(wallet);
  const topModule = byModule[0];
  const burnPerDay = spent30 / 30;
  const runwayDays =
    burnPerDay > 0 ? Math.floor(wallet.balance / burnPerDay) : null;
  const lowBalance = wallet.balance < 25;
  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount >= 5;

  const confirmTopUp = async () => {
    if (!amountValid || !workspaceId) return;
    if (!wallet.allowDevTopup) {
      toast.error("Card top-ups are not live yet", {
        description: "The wallet is real; adding funds via card comes next.",
      });
      return;
    }
    setProcessing(true);
    const label =
      PAYMENT_METHODS.find((m) => m.id === method)?.label ?? "Dev credit";
    try {
      await topUpWalletApi(workspaceId, parsedAmount, label);
      invalidateWallet();
      setTopUpOpen(false);
      toast.success(`${formatMoney(parsedAmount)} added to your wallet`, {
        description: "Development credit — not a real card charge.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Top-up failed");
    } finally {
      setProcessing(false);
    }
  };

  const persistAutoReload = async (
    enabled: boolean,
    threshold = wallet.autoReload.threshold,
    amountValue = wallet.autoReload.amount
  ) => {
    if (!workspaceId) return;
    try {
      await saveWalletAutoReloadApi(workspaceId, {
        enabled,
        threshold,
        amount: amountValue,
      });
      invalidateWallet();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save auto-reload"
      );
    }
  };

  const exportCsv = () => {
    const blob = new Blob([transactionsToCsv(wallet.transactions)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wallet-${slug}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Statement exported");
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <WalletIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Wallet</h1>
              <p className="text-xs text-muted-foreground">
                Pay-as-you-go balance in USD for keyword extraction, image
                search and other metered runs.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
              onClick={exportCsv}
            >
              <Download className="h-3.5 w-3.5" />
              Export statement
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5 text-xs"
              onClick={() => setTopUpOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add funds
            </Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card
            className={cn(
              "lg:col-span-1 overflow-hidden",
              lowBalance && "border-amber-500/40"
            )}
          >
            <CardHeader className="pb-2">
              <CardDescription className="text-xs">
                Available balance
              </CardDescription>
              <CardTitle className="text-4xl font-semibold tabular-nums tracking-tight">
                {formatMoney(wallet.balance)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lowBalance ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                  Balance is low. Runs are blocked once it hits $0 — top up to
                  keep analyses going.
                </p>
              ) : runwayDays !== null ? (
                <p className="text-[11px] text-muted-foreground">
                  About{" "}
                  <span className="font-medium text-foreground">
                    {runwayDays} days
                  </span>{" "}
                  of runway at your current pace.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No spending yet this month.
                </p>
              )}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                Funds are only drawn after you confirm a priced run.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs">
                Spent · last 30 days
              </CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums tracking-tight">
                {formatMoney(spent30)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <TrendingDown className="h-3.5 w-3.5" />
                {formatMoney(spent7)} in the last 7 days
              </div>
              {byModule.length > 0 ? (
                <div className="space-y-1.5">
                  {byModule.slice(0, 3).map((row) => {
                    const pct = topModule
                      ? Math.max(6, (row.amount / topModule.amount) * 100)
                      : 0;
                    return (
                      <div key={row.module} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            {row.module}
                          </span>
                          <span className="tabular-nums font-medium">
                            {formatMoney(row.amount)}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted">
                          <div
                            className="h-1.5 rounded-full bg-primary/70"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-primary" />
                Auto-reload
              </CardTitle>
              <CardDescription className="text-xs">
                Keep long runs from stopping mid-way.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {wallet.autoReload.enabled ? "Enabled" : "Disabled"}
                </span>
                <Button
                  size="sm"
                  variant={wallet.autoReload.enabled ? "outline" : "default"}
                  className="h-7 text-[11px]"
                  onClick={() => {
                    void persistAutoReload(!wallet.autoReload.enabled);
                    toast.success(
                      wallet.autoReload.enabled
                        ? "Auto-reload turned off"
                        : "Auto-reload preference saved"
                    );
                  }}
                >
                  {wallet.autoReload.enabled ? "Turn off" : "Turn on"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">
                    When below
                  </Label>
                  <Input
                    type="number"
                    min={5}
                    value={wallet.autoReload.threshold}
                    onChange={(e) =>
                      void persistAutoReload(
                        wallet.autoReload.enabled,
                        Math.max(0, Number(e.target.value)),
                        wallet.autoReload.amount
                      )
                    }
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">
                    Add
                  </Label>
                  <Input
                    type="number"
                    min={10}
                    value={wallet.autoReload.amount}
                    onChange={(e) =>
                      void persistAutoReload(
                        wallet.autoReload.enabled,
                        wallet.autoReload.threshold,
                        Math.max(0, Number(e.target.value))
                      )
                    }
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Preference is saved now. Automatic card charges will use this
                threshold once payments go live.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-sm">Transactions</CardTitle>
              <CardDescription className="text-xs">
                Every top-up and metered run, newest first.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-8 w-[160px] text-xs"
                aria-label="Search transactions"
              />
              <div className="flex items-center gap-1">
                {(
                  [
                    ["all", "All"],
                    ["topup", "Top-ups"],
                    ["charge", "Charges"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      filter === value
                        ? "border-transparent bg-muted text-foreground"
                        : "border-border/70 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 text-xs">Date</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs">Module</TableHead>
                  <TableHead className="text-xs">Method</TableHead>
                  <TableHead className="pr-6 text-right text-xs">
                    Amount
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-xs text-muted-foreground"
                    >
                      No transactions match this view.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((tx) => {
                    const incoming = tx.amount >= 0;
                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="pl-6 whitespace-nowrap text-xs text-muted-foreground">
                          <div className="text-foreground">
                            {formatDate(tx.createdAt)}
                          </div>
                          <div className="text-[10px]">
                            {formatTime(tx.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={cn(
                                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                                incoming
                                  ? "bg-emerald-500/12 text-emerald-600"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {incoming ? (
                                <ArrowDownLeft className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              )}
                            </span>
                            {tx.description}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] font-medium",
                              MODULE_TONE[tx.module] ??
                                "text-muted-foreground border-border"
                            )}
                          >
                            {tx.module}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {tx.method ?? "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "pr-6 text-right text-sm font-medium tabular-nums whitespace-nowrap",
                            incoming
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-foreground"
                          )}
                        >
                          {incoming ? "+" : ""}
                          {formatMoney(tx.amount)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border/70 px-3 py-2.5">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">
            {wallet.allowDevTopup
              ? "This workspace wallet lives in the database. Add funds credits the balance for testing — not a card charge."
              : "This workspace wallet lives in the database. Card top-ups will land here once payments go live."}
          </span>
        </div>
      </div>

      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Add funds</DialogTitle>
            <DialogDescription>
              Funds land instantly and never expire. Minimum $5.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {TOPUP_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(String(preset))}
                  className={cn(
                    "rounded-lg border py-2 text-sm font-medium tabular-nums transition-colors",
                    Number(amount) === preset
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/70 text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  )}
                >
                  ${preset}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="topup-amount" className="text-xs">
                Custom amount (USD)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="topup-amount"
                  type="number"
                  min={5}
                  step={5}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-6 tabular-nums"
                />
              </div>
              {!amountValid ? (
                <p className="text-[11px] text-destructive">
                  Enter an amount of $5 or more.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Payment method</Label>
              <div className="space-y-1.5">
                {PAYMENT_METHODS.map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => setMethod(pm.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      method === pm.id
                        ? "border-primary bg-primary/5"
                        : "border-border/70 hover:border-foreground/30"
                    )}
                  >
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{pm.label}</span>
                    {method === pm.id ? (
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">New balance</span>
              <span className="font-semibold tabular-nums">
                {formatMoney(
                  wallet.balance + (amountValid ? parsedAmount : 0)
                )}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTopUpOpen(false)}
              disabled={processing}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmTopUp}
              disabled={!amountValid || processing}
              className="gap-1.5"
            >
              {processing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Processing…
                </>
              ) : (
                `Pay ${amountValid ? formatMoney(parsedAmount) : "$0.00"}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
