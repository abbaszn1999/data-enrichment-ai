"use client";

import { useState } from "react";
import { Bot, Check, Gauge, Lightbulb, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RECOMMENDATION_CATEGORIES } from "@/lib/google-ads/constants";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { Recommendation, RecommendationCategory } from "@/lib/google-ads/types";
import { toast } from "sonner";
import { Card, EmptyState, Pill, Segmented, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

/** Recommendations that need input go to the agent instead of a one-click apply. */
const AGENT_PROMPT: Record<string, string> = {
  RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH: "Write better ads for my weakest ad group",
  DISAPPROVED_AD: "Fix my disapproved ads",
  ENHANCED_CONVERSIONS: "Check my conversion tracking",
};

export function RecommendationsView() {
  const { data, campaign } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [category, setCategory] = useState<"ALL" | RecommendationCategory>("ALL");

  const recs = data.recommendations.filter((r) => r.status === "ACTIVE" && (!campaign || r.campaignId === campaign.id));
  const shown = recs.filter((r) => category === "ALL" || r.category === category).sort((a, b) => b.scoreUplift - a.scoreUplift);
  const categories = [...new Set(recs.map((r) => r.category))];
  const done = data.recommendations.filter((r) => r.status !== "ACTIVE" && (!campaign || r.campaignId === campaign.id));

  const apply = (r: Recommendation) => {
    const res = applyDirect(`Google Ads Recommendation: ${r.title}`, [...r.ops, { kind: "recommendation.set", ids: [r.id], status: "APPLIED" }], "RECOMMENDATION");
    if (res.ok) toast.success(`Applied: ${r.title}`);
    else toast.error(res.error);
  };
  const dismiss = (r: Recommendation) => applyDirect(`Dismiss recommendation: ${r.title}`, [{ kind: "recommendation.set", ids: [r.id], status: "DISMISSED" }], "RECOMMENDATION");

  return (
    <div>
      <ViewHeader title="Recommendations" subtitle="Google Ads Recommendations for this account. Apply directly, or let the agent handle the ones that need new copy or tracking." />
      <Card className="mb-4 flex flex-wrap items-center gap-6 p-4">
        <div className="flex items-center gap-3">
          <Gauge className="h-8 w-8 text-[#400095] dark:text-violet-400" />
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground">Optimization score</p>
            <p className="text-2xl font-black tabular-nums">{(data.account.optimizationScore * 100).toFixed(1)}%</p>
          </div>
        </div>
        <div className="h-2 min-w-48 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-gradient-to-r from-[#400095] to-[#F76D01] transition-all" style={{ width: `${data.account.optimizationScore * 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {recs.length} open · up to <span className="font-semibold text-foreground">+{recs.reduce((s, r) => s + r.scoreUplift, 0).toFixed(1)} pts</span>
        </p>
      </Card>

      {categories.length > 1 && (
        <div className="mb-4">
          <Segmented
            value={category}
            onChange={setCategory}
            size="xs"
            options={[{ value: "ALL" as const, label: "All", count: recs.length }, ...categories.map((c) => ({ value: c, label: RECOMMENDATION_CATEGORIES[c], count: recs.filter((r) => r.category === c).length }))]}
          />
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={Lightbulb} title="You're all caught up" body="No open recommendations right now." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((r) => {
            const prompt = AGENT_PROMPT[r.type];
            return (
              <Card key={r.id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                    <Lightbulb className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{RECOMMENDATION_CATEGORIES[r.category]}</p>
                    <p className="text-sm font-bold">{r.title}</p>
                  </div>
                  <Pill tone="brand">+{r.scoreUplift.toFixed(1)}%</Pill>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{r.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.campaignId && <Pill>{data.campaigns.find((c) => c.id === r.campaignId)?.name}</Pill>}
                  {r.impact && <Pill tone="good">{r.impact}</Pill>}
                </div>
                <div className="mt-auto flex gap-2 pt-3">
                  {r.ops.length > 0 ? (
                    <button type="button" onClick={() => apply(r)} className="inline-flex items-center gap-1 rounded-lg bg-[#400095] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#33007a] dark:bg-violet-600">
                      <Check className="h-3.5 w-3.5" /> Apply
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => runAgentTurn(prompt ?? `Help me with this recommendation: ${r.title}`)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#400095]/10 px-3 py-1.5 text-[11px] font-semibold text-[#400095] hover:bg-[#400095]/15 dark:bg-violet-500/15 dark:text-violet-300"
                    >
                      <Bot className="h-3.5 w-3.5" /> Do it with the agent
                    </button>
                  )}
                  <button type="button" onClick={() => dismiss(r)} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 text-[11px] font-medium hover:bg-muted">
                    <X className="h-3.5 w-3.5" /> Dismiss
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <p className={cn("mt-4 text-[11px] text-muted-foreground")}>
          {done.filter((r) => r.status === "APPLIED").length} applied · {done.filter((r) => r.status === "DISMISSED").length} dismissed (see Change history to undo)
        </p>
      )}
    </div>
  );
}
