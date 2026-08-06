"use client";

import { useEffect, useState, useMemo } from "react";
import {
  CreditCard,
  Sparkles,
  TrendingUp,
  Clock,
  Loader2,
  AlertTriangle,
  Zap,
  ArrowUpRight,
  BarChart3,
  Image as ImageIcon,
  FolderTree,
  Columns3,
  Coins,
  Activity,
  Crown,
  Users,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkspaceContext } from "../layout";
import { useUsage } from "@/hooks/use-usage";
import { formatCredits } from "@/lib/format-credits";

const OP_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  ai_enrichment: { label: "AI Enrichment", icon: Sparkles, color: "text-purple-600" },
  ai_image_search: { label: "AI Image Search", icon: ImageIcon, color: "text-blue-600" },
  ai_column_mapping: { label: "AI Column Mapping", icon: Columns3, color: "text-amber-600" },
  ai_category_suggest: { label: "AI Category Suggest", icon: FolderTree, color: "text-green-600" },
  ai_function: { label: "AI Function", icon: Zap, color: "text-indigo-600" },
  credit_topup: { label: "Credit Top-up", icon: Zap, color: "text-emerald-600" },
  monthly_reset: { label: "Monthly Reset", icon: Clock, color: "text-gray-600" },
};

export default function UsagePage() {
  const { workspace } = useWorkspaceContext();
  const params = useParams();
  const slug = params.workspaceSlug as string;

  const { data, isLoading: usageLoading } = useUsage(workspace?.id ?? null);
  const [filterUser, setFilterUser] = useState<string>("all");
  const [filterOpen, setFilterOpen] = useState(false);

  const transactions = data?.transactions ?? [];
  const members = data?.members ?? [];
  const balance = data?.balance ?? { used: 0, total: 0, remaining: 0, bonus: 0 };
  const plan = data?.plan;
  const subscription = data?.subscription;

  const loading = usageLoading;

  const filteredTransactions = useMemo(() => {
    if (filterUser === "all") return transactions;
    return transactions.filter((tx: any) => tx.user_id === filterUser);
  }, [transactions, filterUser]);

  const allTimeUsed = useMemo(
    () => transactions.reduce((sum: number, t: any) => sum + (t.credits_used > 0 ? t.credits_used : 0), 0),
    [transactions]
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const usagePercent =
    balance.total > 0 ? Math.round((balance.used / balance.total) * 100) : 0;
  const isLow = balance.total > 0 && balance.remaining < balance.total * 0.2;

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
      <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Usage & Credits
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Track AI credit usage and subscription details for{" "}
                <span className="font-medium text-foreground">
                  {workspace?.name}
                </span>
                .
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 self-start shadow-sm sm:self-auto" asChild>
            <Link href={`/w/${slug}/subscription`}>
              <ArrowUpRight className="h-3.5 w-3.5" /> View Plans
            </Link>
          </Button>
        </header>

        {/* Credits Overview */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm md:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Coins className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    AI Credits Remaining
                  </p>
                  <p className="mt-0.5 text-2xl font-bold tracking-tight">
                    {formatCredits(balance.remaining)}
                    <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                      / {formatCredits(balance.total)}
                    </span>
                  </p>
                </div>
              </div>
              {plan && (
                <Badge variant="secondary" className="px-2.5 py-0.5 text-[10px] font-semibold">
                  {plan.displayName} Plan
                </Badge>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isLow ? "bg-amber-500" : "bg-primary"
                  }`}
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{formatCredits(balance.used)} used this month</span>
                {balance.resetsAt && (
                  <span>
                    Resets {new Date(balance.resetsAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>

            {balance.bonus > 0 && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Zap className="h-3 w-3 text-emerald-500" />
                <span>+{formatCredits(balance.bonus)} bonus credits available</span>
              </div>
            )}

            {isLow && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200/40 bg-amber-50 p-3.5 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    Running low on AI credits
                  </p>
                  <p className="mt-0.5 text-[10px] text-amber-600/80">
                    Upgrade your plan or purchase more credits.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-amber-300 text-xs text-amber-700 hover:bg-amber-50"
                  asChild
                >
                  <Link href={`/w/${slug}/subscription`}>Upgrade</Link>
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                <Crown className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Current Plan
                </p>
                <p className="text-base font-bold">
                  {plan?.displayName || "Free"}
                </p>
              </div>
            </div>
            <div className="space-y-2.5 border-t pt-3 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {subscription?.billingCycle === "yearly"
                    ? "Yearly Credits"
                    : "Monthly Credits"}
                </span>
                <span className="font-semibold">
                  {formatCredits(
                    subscription?.billingCycle === "yearly"
                      ? (plan?.monthlyCredits ?? 0) * 12
                      : plan?.monthlyCredits ?? 0
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Price</span>
                <span className="font-semibold">
                  {subscription?.billingCycle === "yearly"
                    ? plan?.priceYearly > 0
                      ? `$${plan.priceYearly}/yr`
                      : "Free"
                    : plan?.priceMonthly > 0
                      ? `$${plan.priceMonthly}/mo`
                      : "Free"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge
                  variant="secondary"
                  className="border-emerald-200/40 bg-emerald-50 text-[9px] text-emerald-700 dark:bg-emerald-950/30"
                >
                  {subscription?.status || "active"}
                </Badge>
              </div>
            </div>
            <Button size="sm" variant="outline" className="mt-1 w-full gap-1.5 text-xs" asChild>
              <Link href={`/w/${slug}/subscription`}>
                <ArrowUpRight className="h-3.5 w-3.5" />
                View Plans
              </Link>
            </Button>
          </div>
        </div>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Used (Month)",
              value: balance.used,
              icon: Coins,
              style: "bg-primary/10 text-primary",
            },
            {
              label: "Used (All Time)",
              value: allTimeUsed,
              icon: TrendingUp,
              style: "bg-violet-500/10 text-violet-600",
            },
            {
              label: "AI Operations",
              value: transactions.length,
              icon: Activity,
              style: "bg-blue-500/10 text-blue-600",
              format: (v: number) => v.toLocaleString(),
            },
            {
              label: "Avg / Op",
              value:
                transactions.length > 0
                  ? allTimeUsed / transactions.length
                  : 0,
              icon: BarChart3,
              style: "bg-amber-500/10 text-amber-600",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-sm"
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.style}`}
              >
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-lg font-bold leading-none">
                  {"format" in stat && stat.format
                    ? stat.format(stat.value)
                    : formatCredits(stat.value)}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="border-b bg-muted/20 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Zap className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">What Uses Credits</h2>
                <p className="text-[11px] text-muted-foreground">
                  Credits are consumed exclusively by AI operations. All other
                  actions are free.
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
            {[
              {
                label: "AI Enrichment",
                desc: "Per row enriched",
                icon: Sparkles,
                style: "bg-violet-500/10 text-violet-600",
              },
              {
                label: "AI Image Search",
                desc: "Per query",
                icon: ImageIcon,
                style: "bg-blue-500/10 text-blue-600",
              },
              {
                label: "AI Column Mapping",
                desc: "Per import",
                icon: Columns3,
                style: "bg-amber-500/10 text-amber-600",
              },
              {
                label: "AI Categorization",
                desc: "Per product",
                icon: FolderTree,
                style: "bg-emerald-500/10 text-emerald-600",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border bg-background p-3.5"
              >
                <div
                  className={`mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg ${item.style}`}
                >
                  <item.icon className="h-4 w-4" />
                </div>
                <p className="text-xs font-semibold">{item.label}</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Activity className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Credit Transaction Log</h2>
                <p className="text-[11px] text-muted-foreground">
                  {filteredTransactions.length}{" "}
                  {filterUser !== "all" ? "filtered" : "total"} operations
                </p>
              </div>
            </div>

            {members.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFilterOpen(!filterOpen)}
                  className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs transition-colors hover:bg-muted/50"
                >
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">
                    {filterUser === "all"
                      ? "All Members"
                      : members.find((m: any) => m.userId === filterUser)
                          ?.fullName || "Unknown"}
                  </span>
                  <ChevronDown
                    className={`h-3 w-3 text-muted-foreground transition-transform ${
                      filterOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {filterOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setFilterOpen(false)}
                    />
                    <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border bg-background py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterUser("all");
                          setFilterOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50 ${
                          filterUser === "all" ? "bg-muted/30 font-semibold" : ""
                        }`}
                      >
                        <Users className="h-3 w-3 text-muted-foreground" />
                        All Members
                      </button>
                      {members.map((m: any) => (
                        <button
                          type="button"
                          key={m.userId}
                          onClick={() => {
                            setFilterUser(m.userId);
                            setFilterOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50 ${
                            filterUser === m.userId
                              ? "bg-muted/30 font-semibold"
                              : ""
                          }`}
                        >
                          <span>{m.fullName}</span>
                          <Badge
                            variant="secondary"
                            className="px-1.5 py-0 text-[8px]"
                          >
                            {m.role}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="max-h-[420px] overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-card">
                  <th className="bg-card px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Operation
                  </th>
                  <th className="bg-card px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Credits
                  </th>
                  <th className="bg-card px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    User
                  </th>
                  <th className="bg-card px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center">
                      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                        <Zap className="h-5 w-5 text-muted-foreground/40" />
                      </div>
                      <p className="text-xs font-medium text-muted-foreground">
                        No credit transactions yet
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground/60">
                        Start enriching products to see activity here
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx: any) => {
                    const op = OP_LABELS[tx.operation] || {
                      label: tx.operation,
                      icon: Zap,
                      color: "text-muted-foreground",
                    };
                    const OpIcon = op.icon;
                    return (
                      <tr
                        key={tx.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2 text-xs font-medium">
                            <OpIcon className={`h-3.5 w-3.5 ${op.color}`} />
                            {op.label}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className={`font-mono text-xs font-bold ${
                              tx.credits_used > 0
                                ? "text-destructive"
                                : "text-emerald-600"
                            }`}
                          >
                            {tx.credits_used > 0
                              ? `-${formatCredits(tx.credits_used, true)}`
                              : `+${formatCredits(Math.abs(tx.credits_used), true)}`}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {tx.user_name || "System"}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
