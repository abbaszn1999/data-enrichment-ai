"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Check,
  Zap,
  Rocket,
  Crown,
  CreditCard,
  Coins,
  ArrowRight,
  Sparkles,
  Users,
  Loader2,
  ExternalLink,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "../layout";
import { useSubscription } from "@/hooks/use-subscription";
import { formatCredits } from "@/lib/format-credits";

const PLAN_META: Record<string, { icon: any; color: string; bgColor: string; borderColor: string; activeBorder: string }> = {
  starter: { icon: Zap, color: "text-blue-500", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20", activeBorder: "border-blue-500" },
  growth: { icon: Rocket, color: "text-primary", bgColor: "bg-primary/10", borderColor: "border-primary/20", activeBorder: "border-primary" },
  pro: { icon: Crown, color: "text-amber-500", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/20", activeBorder: "border-amber-500" },
};

export default function SubscriptionPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace } = useWorkspaceContext();
  const {
    subscription, plan: currentPlan, availablePlans, creditPacks,
    credits, isActive, isLoading, refresh,
  } = useSubscription(workspace?.id ?? null);

  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleSubscribe = async (planId: string) => {
    setLoadingAction(planId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "subscription", planId, billingCycle: billing, workspaceSlug: slug }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { /* ignore */ }
    setLoadingAction(null);
  };

  const handleBuyPack = async (packId: string) => {
    setLoadingAction(`pack-${packId}`);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "credit_pack", packId, workspaceSlug: slug }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { /* ignore */ }
    setLoadingAction(null);
  };

  const handleManageBilling = async () => {
    setLoadingAction("portal");
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: slug }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { /* ignore */ }
    setLoadingAction(null);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlanName = currentPlan?.name;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Subscription</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Manage your subscription plan and credits
        </p>
      </div>

      {/* Current Plan Banner */}
      {subscription && (
        <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/40">
          <div className="flex items-center gap-3">
            <div className={`h-9 w-9 rounded-lg ${PLAN_META[currentPlanName || ""]?.bgColor || "bg-primary/10"} flex items-center justify-center`}>
              {(() => { const Icon = PLAN_META[currentPlanName || ""]?.icon || Zap; return <Icon className={`h-4.5 w-4.5 ${PLAN_META[currentPlanName || ""]?.color || "text-primary"}`} />; })()}
            </div>
            <div>
              <div className="text-sm font-semibold">{currentPlan?.display_name || "No Plan"}</div>
              <div className="text-xs text-muted-foreground">
                {credits ? `${formatCredits(credits.total)} credits remaining` : "No credits"}
                {credits?.bonus ? ` (incl. ${formatCredits(credits.bonus)} bonus)` : ""}
                {subscription.status === "past_due" && " · Payment failed"}
                {subscription.cancelAtPeriodEnd && " · Cancels at period end"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isActive ? "secondary" : "destructive"} className="text-[10px]">
              {subscription.status === "active" ? "Active" : subscription.status === "trialing" ? "Trial" : subscription.status}
            </Badge>
            {subscription.stripeSubscriptionId && (
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={handleManageBilling} disabled={loadingAction === "portal"}>
                {loadingAction === "portal" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                Manage Billing
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-3">
        <span className={`text-xs font-medium ${billing === "monthly" ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
        <button
          onClick={() => setBilling(billing === "monthly" ? "yearly" : "monthly")}
          className={`relative inline-flex h-5 w-10 rounded-full border-2 transition-colors ${billing === "yearly" ? "bg-primary border-primary" : "bg-muted border-border"}`}
        >
          <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${billing === "yearly" ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </button>
        <span className={`text-xs font-medium flex items-center gap-1.5 ${billing === "yearly" ? "text-foreground" : "text-muted-foreground"}`}>
          Yearly
          <Badge className="text-[9px] px-1.5 py-0 bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20 font-semibold">Save 20%</Badge>
        </span>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {availablePlans.map((plan: any) => {
          const meta = PLAN_META[plan.name] || PLAN_META.starter;
          const Icon = meta.icon;
          const price = billing === "monthly" ? plan.price_monthly : plan.price_yearly;
          const isCurrentPlan = currentPlanName === plan.name && isActive;
          const isPopular = plan.name === "growth";
          const isLoading_ = loadingAction === plan.id;

          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl border-2 p-5 flex flex-col gap-4 transition-all ${
                isPopular ? `${meta.activeBorder} shadow-lg shadow-primary/10` : `${meta.borderColor} hover:shadow-md`
              }`}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="text-[10px] px-2.5 py-0.5 font-semibold bg-primary text-primary-foreground">Most Popular</Badge>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <div className={`h-9 w-9 rounded-xl ${meta.bgColor} flex items-center justify-center`}>
                  <Icon className={`h-4.5 w-4.5 ${meta.color}`} />
                </div>
                <div>
                  <div className="text-sm font-bold">{plan.display_name}</div>
                  <div className={`text-[10px] font-semibold ${meta.color}`}>
                    {(plan.monthly_ai_credits ?? 0).toLocaleString()} credits/mo
                  </div>
                </div>
              </div>

              <div className="flex items-end gap-1">
                <span className="text-3xl font-extrabold tracking-tight">${price}</span>
                <span className="text-xs text-muted-foreground mb-1">/month</span>
              </div>
              {billing === "yearly" && (
                <p className="text-[10px] text-muted-foreground -mt-2">Billed as ${(price * 12).toLocaleString()}/year</p>
              )}

              <p className="text-xs text-muted-foreground leading-relaxed">{plan.description || ""}</p>

              <Button
                size="sm"
                variant={isPopular ? "default" : "outline"}
                disabled={isCurrentPlan || !!isLoading_}
                className={`w-full gap-1.5 font-semibold ${isPopular ? "" : `border-2 ${meta.borderColor}`}`}
                onClick={() => handleSubscribe(plan.id)}
              >
                {isLoading_ ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isCurrentPlan ? (
                  <><Check className="h-3.5 w-3.5" /> Current Plan</>
                ) : (
                  <><ArrowRight className="h-3.5 w-3.5" /> {subscription ? "Switch to" : "Subscribe to"} {plan.display_name}</>
                )}
              </Button>

              <div className="space-y-2 pt-1 border-t border-border/50">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1">Includes</p>
                {[
                  `${(plan.monthly_ai_credits ?? 0).toLocaleString()} AI credits / month`,
                  plan.max_workspaces ? `Up to ${plan.max_workspaces} workspaces` : "Unlimited workspaces",
                  plan.max_members_per_workspace ? `Up to ${plan.max_members_per_workspace} team members` : "Unlimited team members",
                  "AI Enrichment (all columns)",
                  "CSV / Excel export",
                  "All export platforms",
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={`h-4 w-4 rounded-full ${meta.bgColor} flex items-center justify-center shrink-0`}>
                      <Check className={`h-2.5 w-2.5 ${meta.color}`} />
                    </div>
                    <span className="text-xs text-foreground/80">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Credit Packs */}
      {creditPacks.length > 0 && isActive && (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">Credit Packs</h2>
            </div>
            <p className="text-xs text-muted-foreground">Need more credits? Purchase add-on packs anytime. Credits never expire while your subscription is active.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {creditPacks.map((pack: any) => {
              const isLoading_ = loadingAction === `pack-${pack.id}`;
              return (
                <div key={pack.id} className="rounded-xl border p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <Coins className="h-4 w-4 text-amber-500" />
                      </div>
                      <div>
                        <div className="text-sm font-bold">{pack.display_name}</div>
                        <div className="text-[10px] text-muted-foreground">{(pack.credits ?? 0).toLocaleString()} credits</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">${pack.price}</div>
                      <div className="text-[10px] text-muted-foreground">one-time</div>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => handleBuyPack(pack.id)} disabled={!!isLoading_}>
                    {isLoading_ ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Sparkles className="h-3.5 w-3.5" /> Buy Pack</>}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-muted-foreground">
        Payments processed securely by Stripe. Cancel anytime from the billing portal.
      </p>
    </div>
  );
}
