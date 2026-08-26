"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "motion/react";
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
  Infinity as InfinityIcon,
  ShieldCheck,
  Wallet,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useWorkspaceContext } from "../workspace-context";
import { useSubscription } from "@/hooks/use-subscription";
import { formatCredits } from "@/lib/format-credits";

const CREDIT_TOPUP_USD_PER_CREDIT = 0.3;
const CREDIT_TOPUP_MIN_CREDITS = 100;
const CREDIT_TOPUP_PRESETS = [500, 1000, 2500, 5000, 10000];

const PLAN_META: Record<string, { icon: any; color: string; bgColor: string; borderColor: string; activeBorder: string }> = {
  starter: { icon: Zap, color: "text-blue-500", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20", activeBorder: "border-blue-500" },
  growth: { icon: Rocket, color: "text-[#6B358D] dark:text-[#F76D01]", bgColor: "bg-[#400095]/10 dark:bg-[#F76D01]/10", borderColor: "border-[#6B358D]/20 dark:border-[#F76D01]/20", activeBorder: "border-[#6B358D] dark:border-[#F76D01]" },
  pro: { icon: Crown, color: "text-amber-500", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/20", activeBorder: "border-amber-500" },
};

export default function SubscriptionPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace } = useWorkspaceContext();
  const {
    subscription, plan: currentPlan, availablePlans,
    credits, isActive, isLoading, refresh,
  } = useSubscription(workspace?.id ?? null);

  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [topupCredits, setTopupCredits] = useState("1000");

  const topupCreditsNum = Math.max(0, Math.floor(Number(topupCredits) || 0));
  const topupUsd = Math.round(topupCreditsNum * CREDIT_TOPUP_USD_PER_CREDIT * 100) / 100;
  const topupBelowMin = topupCreditsNum > 0 && topupCreditsNum < CREDIT_TOPUP_MIN_CREDITS;

  const adjustTopup = (delta: number) => {
    setTopupCredits(String(Math.max(0, topupCreditsNum + delta)));
  };

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

  const handleBuyCredits = async () => {
    if (topupCreditsNum < CREDIT_TOPUP_MIN_CREDITS) return;
    setLoadingAction("topup");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "credit_topup", credits: topupCreditsNum, workspaceSlug: slug }),
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
      <div className="autommerce-dashboard h-full flex items-center justify-center [font-family:var(--brand-font)]">
        <Loader2 className="h-6 w-6 animate-spin text-[#6B358D] dark:text-[#F76D01]" />
      </div>
    );
  }

  const currentPlanName = currentPlan?.name;

  return (
    <div className="autommerce-dashboard flex-1 overflow-auto bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-6 py-7">
          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                <CreditCard className="h-4 w-4" />
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                Billing
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
              Choose the plan
              <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                that fits your growth.
              </span>
            </h1>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Manage your subscription plan and credits.
            </p>
          </motion.header>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-8 px-6 py-6">

      {/* Current Plan Banner */}
      {subscription && (
        <div className="flex items-center justify-between p-4 rounded-2xl border border-border/60 bg-muted/40">
          <div className="flex items-center gap-3">
            <div className={`h-9 w-9 rounded-lg ${PLAN_META[currentPlanName || ""]?.bgColor || "bg-[#400095]/10 dark:bg-[#F76D01]/10"} flex items-center justify-center`}>
              {(() => { const Icon = PLAN_META[currentPlanName || ""]?.icon || Zap; return <Icon className={`h-4.5 w-4.5 ${PLAN_META[currentPlanName || ""]?.color || "text-[#6B358D] dark:text-[#F76D01]"}`} />; })()}
            </div>
            <div>
              <div className="text-sm font-bold">{currentPlan?.display_name || "No Plan"}</div>
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
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1 rounded-lg" onClick={handleManageBilling} disabled={loadingAction === "portal"}>
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
          className={`relative inline-flex h-5 w-10 rounded-full border-2 transition-colors ${billing === "yearly" ? "bg-[#400095] border-[#400095] dark:bg-[#F76D01] dark:border-[#F76D01]" : "bg-muted border-border"}`}
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
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className={`relative rounded-2xl border-2 p-5 flex flex-col gap-4 transition-all ${
                isPopular ? `${meta.activeBorder} shadow-lg shadow-[#400095]/10 dark:shadow-[#F76D01]/10` : `${meta.borderColor} hover:shadow-md`
              }`}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="text-[10px] px-2.5 py-0.5 font-semibold bg-[#400095] text-white dark:bg-[#F76D01]">Most Popular</Badge>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <div className={`h-9 w-9 rounded-xl ${meta.bgColor} flex items-center justify-center`}>
                  <Icon className={`h-4.5 w-4.5 ${meta.color}`} />
                </div>
                <div>
                  <div className="text-sm font-bold">{plan.display_name}</div>
                  <div className={`text-[10px] font-semibold ${meta.color}`}>
                    {billing === "yearly"
                      ? `${((plan.monthly_ai_credits ?? 0) * 12).toLocaleString()} credits/year`
                      : `${(plan.monthly_ai_credits ?? 0).toLocaleString()} credits/mo`}
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
                className={`w-full gap-1.5 rounded-xl font-semibold ${isPopular ? "bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90" : `border-2 ${meta.borderColor}`}`}
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
                  billing === "yearly"
                    ? `${((plan.monthly_ai_credits ?? 0) * 12).toLocaleString()} AI credits / year`
                    : `${(plan.monthly_ai_credits ?? 0).toLocaleString()} AI credits / month`,
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
            </motion.div>
          );
        })}
      </div>

      {/* Extra Credits — buy any amount, priced at a flat $0.30/credit */}
      {isActive && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-[#F76D01]/20 bg-gradient-to-br from-[#F76D01]/[0.07] via-background to-[#400095]/[0.06] p-5 sm:p-7">
          <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-[#F76D01]/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-[#400095]/10 blur-3xl" />

          <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Left: pitch + benefits */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-[#F76D01]/15 flex items-center justify-center shrink-0">
                  <Coins className="h-5 w-5 text-[#F76D01]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-tight">Buy Extra Credits</h2>
                  <p className="text-[11px] text-muted-foreground">Top up your balance in one purchase</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Need more than your plan includes? Pick any amount, from a quick top-up to a bulk order —
                no need to buy more than once.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 mt-1">
                {[
                  { icon: InfinityIcon, text: "Never expires while your subscription is active" },
                  { icon: Wallet, text: "Flat $0.30 per credit — no hidden fees" },
                  { icon: ShieldCheck, text: "Secure checkout, processed by Stripe" },
                  { icon: Sparkles, text: "Buy exactly what you need, any amount" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-[#F76D01]/10 flex items-center justify-center shrink-0">
                      <item.icon className="h-3.5 w-3.5 text-[#F76D01]" />
                    </div>
                    <span className="text-xs text-foreground/80">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: purchase panel */}
            <div className="lg:col-span-3 rounded-xl border bg-background/70 backdrop-blur-sm p-4 sm:p-6 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="text-[11px] font-semibold text-muted-foreground mr-1">Quick pick:</span>
                {CREDIT_TOPUP_PRESETS.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setTopupCredits(String(amount))}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      topupCreditsNum === amount
                        ? "bg-[#F76D01] border-[#F76D01] text-white"
                        : "border-border text-muted-foreground hover:border-[#F76D01]/50 hover:text-foreground"
                    }`}
                  >
                    {amount.toLocaleString()}
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                <div className="flex-1 space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground">Credits to buy</label>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 shrink-0"
                      onClick={() => adjustTopup(-100)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <Input
                      type="number"
                      min={CREDIT_TOPUP_MIN_CREDITS}
                      step={100}
                      value={topupCredits}
                      onChange={(e) => setTopupCredits(e.target.value)}
                      className="h-9 text-center text-sm font-semibold"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-9 w-9 shrink-0"
                      onClick={() => adjustTopup(100)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="hidden sm:block h-12 w-px bg-border" />

                <div className="text-center sm:text-right">
                  <div className="text-3xl font-extrabold tracking-tight text-[#F76D01]">
                    ${topupUsd.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">$0.30 / credit · one-time</div>
                </div>
              </div>

              {topupBelowMin && (
                <p className="text-[11px] text-destructive mt-2.5">
                  Minimum purchase is {CREDIT_TOPUP_MIN_CREDITS.toLocaleString()} credits.
                </p>
              )}

              <Button
                className="w-full gap-1.5 mt-4 h-10 font-semibold bg-[#F76D01] hover:bg-[#e05e00] text-white"
                onClick={handleBuyCredits}
                disabled={loadingAction === "topup" || topupCreditsNum < CREDIT_TOPUP_MIN_CREDITS}
              >
                {loadingAction === "topup" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <><Sparkles className="h-4 w-4" /> Buy {topupCreditsNum > 0 ? topupCreditsNum.toLocaleString() : ""} Credits</>
                )}
              </Button>
              <p className="text-[10px] text-center text-muted-foreground mt-2">
                Payments processed securely by Stripe
              </p>
            </div>
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-muted-foreground">
        Payments processed securely by Stripe. Cancel anytime from the billing portal.
      </p>
      </div>
    </div>
  );
}
