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
  Filter,
  Users,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkspaceContext } from "../layout";
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

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState<string>("all");
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    fetch(`/api/credits?workspaceId=${workspace.id}&limit=200`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || "Failed to load credits");
        return json;
      })
      .then((d) => setData(d))
      .catch((err) => {
        console.error(err);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [workspace]);

  const transactions = data?.transactions ?? [];
  const members = data?.members ?? [];
  const balance = data?.balance ?? { used: 0, total: 0, remaining: 0, bonus: 0 };
  const plan = data?.plan;
  const subscription = data?.subscription;

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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const usagePercent = balance.total > 0 ? Math.round((balance.used / balance.total) * 100) : 0;
  const isLow = balance.total > 0 && balance.remaining < balance.total * 0.2;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Usage & Credits</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Track AI credit usage and subscription details for{" "}
          <span className="font-semibold text-foreground">{workspace?.name}</span>
        </p>
      </div>

      {/* Credits Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Main credits bar */}
        <div className="rounded-2xl border-2 border-border/60 p-6 space-y-4 md:col-span-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Coins className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground font-medium">AI Credits Remaining</div>
                <div className="text-3xl font-extrabold tracking-tight mt-0.5">
                  {formatCredits(balance.remaining)}
                  <span className="text-base font-normal text-muted-foreground ml-1.5">
                    / {formatCredits(balance.total)}
                  </span>
                </div>
              </div>
            </div>
            {plan && (
              <Badge variant="secondary" className="text-xs px-3 py-1 font-semibold">
                {plan.displayName} Plan
              </Badge>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
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
                <span>Resets {new Date(balance.resetsAt).toLocaleDateString()}</span>
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
            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/40">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <div className="flex-1">
                <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Running low on AI credits
                </div>
                <div className="text-[10px] text-amber-600/80 mt-0.5">
                  Upgrade your plan or purchase more credits.
                </div>
              </div>
              <Link href={`/w/${slug}/subscription`}>
                <Button size="sm" variant="outline" className="text-xs shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50">
                  Upgrade
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* Plan Card */}
        <div className="rounded-2xl border-2 border-border/60 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Crown className="h-4.5 w-4.5 text-amber-500" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Current Plan</div>
              <div className="text-base font-bold">{plan?.displayName || "Free"}</div>
            </div>
          </div>
          <div className="space-y-2.5 text-[11px] border-t border-border/50 pt-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{subscription?.billingCycle === "yearly" ? "Yearly Credits" : "Monthly Credits"}</span>
              <span className="font-semibold">{formatCredits(subscription?.billingCycle === "yearly" ? (plan?.monthlyCredits ?? 0) * 12 : plan?.monthlyCredits ?? 0)}</span>
            </div>
            <div className="flex justify-between items-center">
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
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Status</span>
              <Badge variant="secondary" className="text-[9px] bg-green-50 text-green-700 dark:bg-green-950/30 border-green-200/40">
                {subscription?.status || "active"}
              </Badge>
            </div>
          </div>
          <Link href={`/w/${slug}/subscription`}>
            <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs mt-1">
              <ArrowUpRight className="h-3.5 w-3.5" />
              View Plans
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Credits Used (Month)", value: balance.used, icon: Coins, color: "text-primary bg-primary/10" },
          { label: "Credits Used (All Time)", value: allTimeUsed, icon: TrendingUp, color: "text-purple-600 bg-purple-500/10" },
          { label: "AI Operations", value: transactions.length, icon: Activity, color: "text-blue-600 bg-blue-500/10" },
          { label: "Avg Credits / Op", value: transactions.length > 0 ? allTimeUsed / transactions.length : 0, icon: BarChart3, color: "text-amber-600 bg-amber-500/10" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border-2 border-border/60 p-4 space-y-2">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${stat.color}`}>
              <stat.icon className="h-4 w-4" />
            </div>
            <div className="text-2xl font-extrabold tracking-tight">{formatCredits(stat.value)}</div>
            <div className="text-[10px] text-muted-foreground font-medium">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* What Uses Credits */}
      <div className="rounded-2xl border-2 border-border/60 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Zap className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold">What Uses Credits</h2>
            <p className="text-[11px] text-muted-foreground">
              Credits are consumed <strong className="text-foreground">exclusively by AI operations</strong>. All other actions are free.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "AI Enrichment", desc: "Per row enriched", icon: Sparkles, color: "text-purple-600 bg-purple-50 dark:bg-purple-950/30" },
            { label: "AI Image Search", desc: "Per query", icon: ImageIcon, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
            { label: "AI Column Mapping", desc: "Per import", icon: Columns3, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
            { label: "AI Categorization", desc: "Per product", icon: FolderTree, color: "text-green-600 bg-green-50 dark:bg-green-950/30" },
          ].map((item) => (
            <div key={item.label} className="p-3.5 rounded-xl border border-border/60 hover:border-border transition-colors">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center mb-2.5 ${item.color}`}>
                <item.icon className="h-4 w-4" />
              </div>
              <div className="text-xs font-semibold">{item.label}</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction Log */}
      <div className="rounded-2xl border-2 border-border/60 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Activity className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold">Credit Transaction Log</h2>
              <p className="text-[11px] text-muted-foreground">
                {filteredTransactions.length} {filterUser !== "all" ? "filtered" : "total"} operations
              </p>
            </div>
          </div>

          {/* Team member filter */}
          {members.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setFilterOpen(!filterOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/60 bg-background hover:bg-muted/50 transition-colors text-xs"
              >
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">
                  {filterUser === "all"
                    ? "All Members"
                    : members.find((m: any) => m.userId === filterUser)?.fullName || "Unknown"}
                </span>
                <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${filterOpen ? "rotate-180" : ""}`} />
              </button>
              {filterOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-lg border border-border/60 bg-background shadow-lg py-1">
                    <button
                      onClick={() => { setFilterUser("all"); setFilterOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2 ${filterUser === "all" ? "bg-muted/30 font-semibold" : ""}`}
                    >
                      <Users className="h-3 w-3 text-muted-foreground" />
                      All Members
                    </button>
                    {members.map((m: any) => (
                      <button
                        key={m.userId}
                        onClick={() => { setFilterUser(m.userId); setFilterOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between ${filterUser === m.userId ? "bg-muted/30 font-semibold" : ""}`}
                      >
                        <span>{m.fullName}</span>
                        <Badge variant="secondary" className="text-[8px] px-1.5 py-0">{m.role}</Badge>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Scrollable table */}
        <div className="overflow-auto max-h-[420px]">
          <table className="w-full">
            <thead className="sticky top-0 z-[1]">
              <tr className="border-b bg-muted/30">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">Operation</th>
                <th className="text-right px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">Credits</th>
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">User</th>
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                      <Zap className="h-5 w-5 text-muted-foreground/40" />
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">No credit transactions yet</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Start enriching products to see activity here</p>
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx: any) => {
                  const op = OP_LABELS[tx.operation] || { label: tx.operation, icon: Zap, color: "text-gray-600" };
                  const OpIcon = op.icon;
                  return (
                    <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <OpIcon className={`h-3.5 w-3.5 ${op.color}`} />
                          {op.label}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`text-xs font-mono font-bold ${
                          tx.credits_used > 0 ? "text-destructive" : "text-green-600"
                        }`}>
                          {tx.credits_used > 0 ? `-${formatCredits(tx.credits_used, true)}` : `+${formatCredits(Math.abs(tx.credits_used), true)}`}
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
      </div>
    </div>
  );
}
