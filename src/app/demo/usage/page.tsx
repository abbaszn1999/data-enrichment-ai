"use client";

import { useState } from "react";
import {
  CreditCard,
  Sparkles,
  Zap,
  TrendingUp,
  Crown,
  Check,
  ArrowRight,
  BarChart3,
  Clock,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  Package,
  Upload,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const plans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/month",
    description: "For individuals getting started",
    credits: 50,
    features: [
      "50 AI credits/month",
      "1 workspace",
      "100 master products",
      "2 import sessions/month",
      "Basic export (CSV only)",
      "1 team member",
    ],
    current: false,
    popular: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    period: "/month",
    description: "For growing businesses",
    credits: 500,
    features: [
      "500 AI credits/month",
      "3 workspaces",
      "5,000 master products",
      "Unlimited imports",
      "All export platforms",
      "5 team members",
      "Priority AI processing",
      "Email support",
    ],
    current: true,
    popular: true,
  },
  {
    id: "business",
    name: "Business",
    price: "$79",
    period: "/month",
    description: "For teams and enterprises",
    credits: 2000,
    features: [
      "2,000 AI credits/month",
      "Unlimited workspaces",
      "Unlimited products",
      "Unlimited imports",
      "All export platforms",
      "Unlimited team members",
      "Fastest AI processing",
      "Custom export templates",
      "API access",
      "Priority support",
    ],
    current: false,
    popular: false,
  },
];

const usageHistory = [
  { date: "Mar 18, 2026", action: "AI Enrichment — Samsung Q3 Shipment", credits: 12, type: "enrichment" },
  { date: "Mar 17, 2026", action: "AI Enrichment — Dell Monthly Restock", credits: 20, type: "enrichment" },
  { date: "Mar 16, 2026", action: "AI Column Mapping — JBL Audio Import", credits: 3, type: "mapping" },
  { date: "Mar 15, 2026", action: "AI Enrichment — HP Accessories Batch", credits: 35, type: "enrichment" },
  { date: "Mar 14, 2026", action: "AI Column Mapping — Samsung Q3 Shipment", credits: 3, type: "mapping" },
  { date: "Mar 12, 2026", action: "AI Enrichment — New Supplier Onboarding", credits: 45, type: "enrichment" },
  { date: "Mar 10, 2026", action: "Monthly credit reset", credits: 500, type: "reset" },
];

const dailyUsage = [
  { day: "Mon", value: 12 },
  { day: "Tue", value: 23 },
  { day: "Wed", value: 8 },
  { day: "Thu", value: 35 },
  { day: "Fri", value: 15 },
  { day: "Sat", value: 5 },
  { day: "Sun", value: 20 },
];

export default function DemoUsagePage() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  const totalCredits = 500;
  const usedCredits = 382;
  const remainingCredits = totalCredits - usedCredits;
  const usagePercent = Math.round((usedCredits / totalCredits) * 100);
  const daysLeft = 12;

  const maxDailyValue = Math.max(...dailyUsage.map((d) => d.value));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Usage & Billing
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage your subscription and monitor credit usage</p>
        </div>
        <Badge variant="secondary" className="text-xs gap-1.5 py-1 px-3 bg-primary/10 text-primary">
          <Crown className="h-3 w-3" /> Pro Plan
        </Badge>
      </div>

      {/* Credits Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Credits Card */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> AI Credits
            </h2>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              Resets in {daysLeft} days
            </div>
          </div>

          <div className="flex items-end gap-6 mb-4">
            <div>
              <div className="text-4xl font-bold tracking-tight">{remainingCredits}</div>
              <div className="text-xs text-muted-foreground">credits remaining</div>
            </div>
            <div className="text-xs text-muted-foreground pb-1">
              <span className="text-foreground font-semibold">{usedCredits}</span> of {totalCredits} used this period
            </div>
          </div>

          <Progress value={usagePercent} className="h-3 mb-2" />

          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{usagePercent}% used</span>
            {usagePercent > 80 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                Running low — consider upgrading
              </span>
            )}
          </div>

          {/* Daily Usage Mini Chart */}
          <div className="mt-6 pt-4 border-t">
            <h3 className="text-xs font-semibold mb-3 flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" /> This Week
            </h3>
            <div className="flex items-end gap-2 h-20">
              {dailyUsage.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: "56px" }}>
                    <div
                      className="w-full max-w-[28px] rounded-t bg-primary/80 hover:bg-primary transition-colors cursor-default"
                      style={{ height: `${(d.value / maxDailyValue) * 100}%`, minHeight: "4px" }}
                      title={`${d.value} credits`}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{d.day}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Quick Stats */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                <Brain className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <div className="text-lg font-bold">{usedCredits}</div>
                <div className="text-[10px] text-muted-foreground">Credits used this month</div>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-50 dark:bg-green-950/30 flex items-center justify-center">
                <Package className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <div className="text-lg font-bold">156</div>
                <div className="text-[10px] text-muted-foreground">Products enriched</div>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center">
                <Upload className="h-4 w-4 text-purple-600" />
              </div>
              <div>
                <div className="text-lg font-bold">8</div>
                <div className="text-[10px] text-muted-foreground">Import sessions this month</div>
              </div>
            </div>
          </Card>

          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold">Need more credits?</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-3">
              Upgrade your plan or purchase add-on credit packs.
            </p>
            <Button size="sm" className="w-full text-xs gap-1.5">
              <TrendingUp className="h-3 w-3" /> Upgrade Plan
            </Button>
          </Card>
        </div>
      </div>

      {/* Credit Cost Reference */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-4">Credit Cost Reference</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { action: "AI Product Enrichment", cost: "3 credits", desc: "Per product", icon: Sparkles, color: "text-purple-600 bg-purple-50 dark:bg-purple-950/30" },
            { action: "AI Column Mapping", cost: "1 credit", desc: "Per import session", icon: Brain, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
            { action: "AI SKU Matching", cost: "1 credit", desc: "Per import session", icon: RefreshCw, color: "text-green-600 bg-green-50 dark:bg-green-950/30" },
            { action: "Export Generation", cost: "Free", desc: "All plans", icon: CreditCard, color: "text-gray-500 bg-gray-50 dark:bg-gray-950/30" },
          ].map((item) => (
            <div key={item.action} className="p-3 rounded-lg border bg-muted/20">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center mb-2 ${item.color}`}>
                <item.icon className="h-4 w-4" />
              </div>
              <div className="text-xs font-semibold">{item.action}</div>
              <div className="text-sm font-bold text-primary mt-0.5">{item.cost}</div>
              <div className="text-[9px] text-muted-foreground">{item.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Subscription Plans */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Subscription Plans</h2>
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                billingCycle === "monthly" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle("yearly")}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                billingCycle === "yearly" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              Yearly <span className="text-green-600 ml-1">-20%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const price = billingCycle === "yearly"
              ? plan.id === "free" ? "$0" : plan.id === "pro" ? "$23" : "$63"
              : plan.price;
            return (
              <Card
                key={plan.id}
                className={`p-5 relative ${
                  plan.current ? "border-primary shadow-md ring-1 ring-primary/20" : ""
                } ${plan.popular ? "border-primary/50" : ""}`}
              >
                {plan.popular && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground text-[9px] px-2 py-0">
                      Most Popular
                    </Badge>
                  </div>
                )}
                {plan.current && (
                  <div className="absolute -top-2.5 right-3">
                    <Badge variant="outline" className="bg-background text-[9px] px-2 py-0 border-primary text-primary">
                      Current Plan
                    </Badge>
                  </div>
                )}

                <div className="mb-4">
                  <h3 className="text-sm font-bold">{plan.name}</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{plan.description}</p>
                </div>

                <div className="mb-4">
                  <span className="text-3xl font-bold">{price}</span>
                  <span className="text-xs text-muted-foreground">/{billingCycle === "yearly" ? "mo" : "month"}</span>
                  {billingCycle === "yearly" && plan.id !== "free" && (
                    <div className="text-[10px] text-green-600 mt-0.5">
                      Billed ${plan.id === "pro" ? "276" : "756"}/year
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-4 p-2 rounded-md bg-muted/50">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-xs font-semibold">{plan.credits.toLocaleString()} AI credits/month</span>
                </div>

                <ul className="space-y-2 mb-5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[10px]">
                      <Check className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {plan.current ? (
                  <Button variant="outline" size="sm" className="w-full text-xs" disabled>
                    Current Plan
                  </Button>
                ) : (
                  <Button
                    variant={plan.popular ? "default" : "outline"}
                    size="sm"
                    className="w-full text-xs gap-1.5"
                  >
                    {plan.id === "free" ? "Downgrade" : "Upgrade"} <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Usage History */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold">Credit History</h2>
          <Button variant="ghost" size="sm" className="text-[10px] gap-1 h-7">
            View All <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-2.5 font-semibold">Date</th>
              <th className="text-left px-4 py-2.5 font-semibold">Action</th>
              <th className="text-right px-4 py-2.5 font-semibold">Credits</th>
            </tr>
          </thead>
          <tbody>
            {usageHistory.map((entry, i) => (
              <tr key={i} className="border-b hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{entry.date}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {entry.type === "enrichment" && <Sparkles className="h-3 w-3 text-purple-500" />}
                    {entry.type === "mapping" && <Brain className="h-3 w-3 text-blue-500" />}
                    {entry.type === "reset" && <RefreshCw className="h-3 w-3 text-green-500" />}
                    <span className="font-medium">{entry.action}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {entry.type === "reset" ? (
                    <span className="text-green-600">+{entry.credits}</span>
                  ) : (
                    <span className="text-red-500">-{entry.credits}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Billing Info */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-4">Billing Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Payment Method</label>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="h-8 w-12 rounded border bg-muted/50 flex items-center justify-center">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-xs font-medium">•••• •••• •••• 4242</div>
                  <div className="text-[10px] text-muted-foreground">Expires 08/2027</div>
                </div>
                <Button variant="ghost" size="sm" className="text-[10px] h-6 ml-auto">Change</Button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Billing Email</label>
              <div className="text-xs mt-1">ahmed@techstore.com</div>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Next Invoice</label>
              <div className="text-xs mt-1 font-medium">April 10, 2026 — $29.00</div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Billing Period</label>
              <div className="text-xs mt-1">March 10 — April 10, 2026</div>
            </div>
            <Button variant="outline" size="sm" className="text-[10px] h-7 gap-1.5">
              <CreditCard className="h-3 w-3" /> View Invoices
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
