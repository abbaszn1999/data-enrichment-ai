"use client";

import { useEffect, useState } from "react";
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
  Search as SearchIcon,
  Image as ImageIcon,
  FolderTree,
  Columns3,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspaceContext } from "../layout";
import {
  getWorkspaceSubscription,
  getCreditBalance,
  getCreditTransactions,
} from "@/lib/supabase";

const OP_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  ai_enrichment: { label: "AI Enrichment", icon: Sparkles, color: "text-purple-600" },
  ai_image_search: { label: "AI Image Search", icon: ImageIcon, color: "text-blue-600" },
  ai_column_mapping: { label: "AI Column Mapping", icon: Columns3, color: "text-amber-600" },
  ai_category_suggest: { label: "AI Category Suggest", icon: FolderTree, color: "text-green-600" },
  credit_topup: { label: "Credit Top-up", icon: Zap, color: "text-emerald-600" },
  monthly_reset: { label: "Monthly Reset", icon: Clock, color: "text-gray-600" },
};

export default function UsagePage() {
  const { workspace } = useWorkspaceContext();
  const [subscription, setSubscription] = useState<any>(null);
  const [credits, setCredits] = useState({ used: 0, total: 0, remaining: 0 });
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace) return;
    Promise.all([
      getWorkspaceSubscription(workspace.id),
      getCreditBalance(workspace.id),
      getCreditTransactions(workspace.id),
    ])
      .then(([sub, bal, txns]) => {
        setSubscription(sub);
        setCredits(bal);
        setTransactions(txns);
      })
      .finally(() => setLoading(false));
  }, [workspace]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const plan = subscription?.subscription_plans;
  const usagePercent = credits.total > 0 ? Math.round((credits.used / credits.total) * 100) : 0;
  const isLow = credits.total > 0 && credits.remaining < credits.total * 0.2;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> Usage & Credits
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Track AI credit usage and subscription details
        </p>
      </div>

      {/* Credits Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 md:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs text-muted-foreground">AI Credits Remaining</div>
              <div className="text-3xl font-bold mt-1">
                {credits.remaining.toLocaleString()}
                <span className="text-base font-normal text-muted-foreground ml-1">
                  / {credits.total.toLocaleString()}
                </span>
              </div>
            </div>
            {plan && (
              <Badge variant="secondary" className="text-xs px-3 py-1">
                {plan.display_name} Plan
              </Badge>
            )}
          </div>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isLow ? "bg-amber-500" : "bg-primary"
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
            <span>{credits.used.toLocaleString()} used this month</span>
            {subscription?.credits_reset_at && (
              <span>Resets {new Date(subscription.credits_reset_at).toLocaleDateString()}</span>
            )}
          </div>

          {isLow && (
            <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/40">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <div className="flex-1">
                <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  Running low on AI credits
                </div>
                <div className="text-[10px] text-amber-600/80">
                  Upgrade your plan or purchase more credits.
                </div>
              </div>
              <Button size="sm" variant="outline" className="text-xs shrink-0">
                Upgrade
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <div className="text-xs text-muted-foreground">Current Plan</div>
          <div className="text-lg font-bold">{plan?.display_name || "No Plan"}</div>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly Credits</span>
              <span className="font-medium">{plan?.monthly_ai_credits?.toLocaleString() || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price</span>
              <span className="font-medium">
                {plan?.price_monthly > 0 ? `$${plan.price_monthly}/mo` : "Free"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant="secondary" className="text-[9px] bg-green-50 text-green-700 dark:bg-green-950/30">
                {subscription?.status || "active"}
              </Badge>
            </div>
          </div>
        </Card>
      </div>

      {/* What Costs Credits */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4" /> What Uses Credits
        </h2>
        <p className="text-[10px] text-muted-foreground mb-4">
          Credits are consumed <strong>exclusively by AI operations</strong>. All other operations are free.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "AI Enrichment", desc: "Per row enriched", icon: Sparkles, color: "text-purple-600 bg-purple-50 dark:bg-purple-950/30" },
            { label: "AI Image Search", desc: "Per query", icon: ImageIcon, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
            { label: "AI Column Mapping", desc: "Per import", icon: Columns3, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
            { label: "AI Categorization", desc: "Per product (future)", icon: FolderTree, color: "text-green-600 bg-green-50 dark:bg-green-950/30" },
          ].map((item) => (
            <div key={item.label} className="p-3 rounded-lg border">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center mb-2 ${item.color}`}>
                <item.icon className="h-4 w-4" />
              </div>
              <div className="text-[11px] font-medium">{item.label}</div>
              <div className="text-[9px] text-muted-foreground">{item.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-[10px] text-muted-foreground">Credits Used (Month)</div>
          <div className="text-2xl font-bold mt-1">{credits.used}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] text-muted-foreground">Credits Used (All Time)</div>
          <div className="text-2xl font-bold mt-1">{transactions.reduce((sum, t) => sum + (t.credits_used > 0 ? t.credits_used : 0), 0)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] text-muted-foreground">AI Operations</div>
          <div className="text-2xl font-bold mt-1">{transactions.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] text-muted-foreground">Avg Credits/Op</div>
          <div className="text-2xl font-bold mt-1">
            {transactions.length > 0 ? Math.round(credits.used / transactions.length) : 0}
          </div>
        </Card>
      </div>

      {/* Transaction Log */}
      <Card>
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">Credit Transaction Log</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Operation</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Credits</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">User</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8">
                    <Zap className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No credit transactions yet</p>
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const op = OP_LABELS[tx.operation] || { label: tx.operation, icon: Zap, color: "text-gray-600" };
                  const OpIcon = op.icon;
                  return (
                    <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 text-xs">
                          <OpIcon className={`h-3.5 w-3.5 ${op.color}`} />
                          {op.label}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono font-medium">
                        {tx.credits_used > 0 ? `-${tx.credits_used}` : `+${Math.abs(tx.credits_used)}`}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {tx.profiles?.full_name || "System"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {new Date(tx.created_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
