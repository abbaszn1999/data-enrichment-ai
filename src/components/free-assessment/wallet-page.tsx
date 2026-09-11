"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Info,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Wallet as WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageLoader } from "@/components/brand/page-loader";
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
import {
  useFaWallet,
  startFaWalletCheckoutApi,
  topUpFaWalletApi,
} from "@/hooks/use-fa-wallet";
import { useWorkspace } from "@/hooks/use-workspace";
import { useRole } from "@/hooks/use-role";
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

const PAGE_SIZES = [10, 20, 50] as const;

const MODULE_TONE: Record<string, string> = {
  "free-assessment":
    "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/25",
  "Free Assessment":
    "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/25",
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

export function FreeAssessmentWalletPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.workspaceSlug as string;
  const { user } = useAuth();
  const { workspace, role } = useWorkspace(slug, user);
  const { canEdit } = useRole(role);
  const workspaceId = workspace?.id ?? "";
  const { wallet, isLoading } = useFaWallet(workspaceId || null);
  const invalidateFaWallet = useWorkspaceStore((s) => s.invalidateFaWallet);

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState<string>("100");
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0].id);
  const [processing, setProcessing] = useState(false);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [txItems, setTxItems] = useState<WalletTx[]>([]);
  const [txNextCursor, setTxNextCursor] = useState<string | null>(null);
  const [txCursorStack, setTxCursorStack] = useState<string[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    setTxCursorStack((stack) => (stack.length ? [] : stack));
  }, [query, pageSize, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    const cursor = txCursorStack[txCursorStack.length - 1];
    const params = new URLSearchParams({
      workspaceId,
      limit: String(pageSize),
    });
    if (query.trim()) params.set("q", query.trim());
    if (cursor) params.set("cursor", cursor);
    setTxLoading(true);
    fetch(`/api/free-assessment/wallet/transactions?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load transactions");
        return res.json() as Promise<{ items: WalletTx[]; nextCursor: string | null }>;
      })
      .then((page) => {
        setTxItems(page.items);
        setTxNextCursor(page.nextCursor);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.error(error instanceof Error ? error.message : "Failed to load transactions");
      })
      .finally(() => setTxLoading(false));
    return () => controller.abort();
  }, [workspaceId, query, pageSize, txCursorStack]);

  useEffect(() => {
    const topup = searchParams.get("topup");
    if (topup === "success") {
      toast.success("Payment received", {
        description: "Your Free Assessment wallet will update in a few seconds.",
      });
      invalidateFaWallet();
      const timers = [1500, 4000].map((delay) =>
        setTimeout(() => invalidateFaWallet(), delay)
      );
      window.history.replaceState(null, "", window.location.pathname);
      return () => timers.forEach(clearTimeout);
    }
    if (topup === "cancelled") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [searchParams, invalidateFaWallet]);

  if (isLoading) {
    return <PageLoader />;
  }

  if (!wallet) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Could not load the Free Assessment wallet.
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
    if (!amountValid || !workspaceId || !canEdit) return;
    setProcessing(true);
    try {
      if (wallet.allowDevTopup) {
        const label =
          PAYMENT_METHODS.find((m) => m.id === method)?.label ?? "Dev credit";
        await topUpFaWalletApi(workspaceId, parsedAmount, label);
        invalidateFaWallet();
        setTopUpOpen(false);
        toast.success(`${formatMoney(parsedAmount)} added to Free Assessment`, {
          description: "Development credit — not a real card charge. Growth Engine wallet is unchanged.",
        });
      } else {
        const url = await startFaWalletCheckoutApi(workspaceId, slug, parsedAmount);
        window.location.href = url;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Top-up failed");
    } finally {
      setProcessing(false);
    }
  };

  const lastTopup = wallet.summaries?.lastTopup ?? null;
  const transactions = txItems;

  const exportCsv = async () => {
    try {
      const rows: WalletTx[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 50; page += 1) {
        const params = new URLSearchParams({
          workspaceId,
          limit: "100",
        });
        if (query.trim()) params.set("q", query.trim());
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(
          `/api/free-assessment/wallet/transactions?${params.toString()}`
        );
        if (!res.ok) throw new Error("Export failed");
        const data = (await res.json()) as {
          items: WalletTx[];
          nextCursor: string | null;
        };
        rows.push(...data.items);
        if (!data.nextCursor) break;
        cursor = data.nextCursor;
      }
      const blob = new Blob([transactionsToCsv(rows)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `free-assessment-wallet-${slug}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Statement exported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  };

  return (
    <div className="autommerce-dashboard flex-1 overflow-auto bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 py-7">
          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                  <WalletIcon className="h-4 w-4" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                  Free Assessment
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
                Assessment wallet
                <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                  separate from Growth Engine.
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                Pay-as-you-go USD for Free Assessment keyword runs only. This
                balance never mixes with Market Research or Growth Sync.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 rounded-xl text-xs"
                onClick={exportCsv}
              >
                <Download className="h-3.5 w-3.5" />
                Export statement
              </Button>
              {canEdit ? (
                <Button
                  size="sm"
                  className="h-9 gap-2 rounded-xl bg-[#400095] px-4 text-[10px] text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                  onClick={() => setTopUpOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add funds
                </Button>
              ) : null}
            </div>
          </motion.header>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card
            className={cn(
              "lg:col-span-1 overflow-hidden rounded-2xl border-border/60 shadow-sm",
              lowBalance && "border-amber-500/40"
            )}
          >
            <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
            <CardHeader className="pb-2">
              <CardDescription className="text-xs">
                Available balance
              </CardDescription>
              <CardTitle className="text-4xl font-black tabular-nums tracking-tight">
                {formatMoney(wallet.balance)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lowBalance ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                  Balance is low. Assessment runs are blocked once it hits $0.
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

          <Card className="rounded-2xl border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs">
                Spent · last 30 days
              </CardDescription>
              <CardTitle className="text-3xl font-black tabular-nums tracking-tight">
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
                            className="h-1.5 rounded-full bg-[#400095] dark:bg-[#F76D01]"
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

          <Card className="rounded-2xl border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Info className="h-4 w-4 text-[#6B358D] dark:text-[#F76D01]" />
                How billing works
              </CardTitle>
              <CardDescription className="text-xs">
                This wallet is only for Free Assessment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <li className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#400095]/60 dark:bg-[#F76D01]/60" />
                  Top-ups here never credit the Growth Engine wallet.
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#400095]/60 dark:bg-[#F76D01]/60" />
                  Funds never expire and carry over every month.
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#400095]/60 dark:bg-[#F76D01]/60" />
                  Runs pause automatically at $0 — no surprise bills.
                </li>
              </ul>
              {lastTopup ? (
                <div className="flex items-center justify-between rounded-lg bg-muted/50 px-2.5 py-1.5 text-[11px]">
                  <span className="text-muted-foreground">Last top-up</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(lastTopup.amount)} · {formatDate(lastTopup.createdAt)}
                  </span>
                </div>
              ) : (
                <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  No top-ups yet — add funds to get started.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-sm font-black">Transactions</CardTitle>
              <CardDescription className="text-xs">
                Free Assessment charges and top-ups only.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-8 w-[160px] rounded-lg text-xs"
                aria-label="Search transactions"
              />
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
                      No transactions yet.
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-6 py-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Rows per page
              <div className="flex items-center gap-1">
                {PAGE_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setPageSize(size)}
                    aria-pressed={pageSize === size}
                    className={cn(
                      "rounded-md border px-2 py-0.5 font-medium transition-colors",
                      pageSize === size
                        ? "border-transparent bg-[#400095] text-white dark:bg-[#F76D01]"
                        : "border-border/70 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                {txLoading
                  ? "Loading…"
                  : `${transactions.length.toLocaleString("en-US")} on this page`}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={txCursorStack.length === 0 || txLoading}
                  onClick={() => setTxCursorStack((stack) => stack.slice(0, -1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={!txNextCursor || txLoading}
                  onClick={() => {
                    if (!txNextCursor) return;
                    setTxCursorStack((stack) => [...stack, txNextCursor]);
                  }}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#6B358D]/30 bg-[#400095]/[0.03] px-3 py-2.5 dark:border-[#F76D01]/30 dark:bg-[#F76D01]/[0.03]">
          <Sparkles className="h-3.5 w-3.5 text-[#6B358D] dark:text-[#F76D01]" />
          <span className="text-[11px] text-muted-foreground">
            {wallet.allowDevTopup
              ? "This Free Assessment wallet lives in its own database tables. Add funds credits it for testing — not a card charge, and not the Growth Engine wallet."
              : "Add funds takes you to Stripe checkout. Payment credits the Free Assessment wallet only."}
          </span>
        </div>
      </div>

      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="sm:max-w-[440px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-black">Add funds</DialogTitle>
            <DialogDescription>
              Credits the Free Assessment wallet only. Minimum $5.
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
                      ? "border-[#400095] bg-[#400095]/10 text-[#400095] dark:border-[#F76D01] dark:bg-[#F76D01]/10 dark:text-[#F76D01]"
                      : "border-border/70 text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  )}
                >
                  ${preset}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fa-topup-amount" className="text-xs">
                Custom amount (USD)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="fa-topup-amount"
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

            {wallet.allowDevTopup ? (
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
                          ? "border-[#400095] bg-[#400095]/5 dark:border-[#F76D01] dark:bg-[#F76D01]/5"
                          : "border-border/70 hover:border-foreground/30"
                      )}
                    >
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{pm.label}</span>
                      {method === pm.id ? (
                        <span className="h-2 w-2 rounded-full bg-[#400095] dark:bg-[#F76D01]" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                You&apos;ll enter your card on Stripe&apos;s secure checkout page next.
                Your Free Assessment balance updates as soon as the payment clears.
              </div>
            )}

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
              className="gap-1.5 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            >
              {processing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {wallet.allowDevTopup ? "Processing…" : "Redirecting…"}
                </>
              ) : wallet.allowDevTopup ? (
                `Pay ${amountValid ? formatMoney(parsedAmount) : "$0.00"}`
              ) : (
                `Continue to payment · ${amountValid ? formatMoney(parsedAmount) : "$0.00"}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
