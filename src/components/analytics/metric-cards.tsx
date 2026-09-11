"use client";

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Eye,
  MousePointer,
  Percent,
  Target,
  TrendingDown,
  Users,
  View,
} from "lucide-react";
import { comparisonLabel } from "@/lib/analytics/dates";
import type { Ga4Overview, GscTotals } from "@/lib/analytics/types";

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone,
  loading,
  changePercent,
  previousValue,
  compare,
  invertColors,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: typeof Users;
  tone: string;
  loading?: boolean;
  changePercent?: number | null;
  previousValue?: string | null;
  compare?: string;
  invertColors?: boolean;
}) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-border/60 bg-card p-5">
        <div className="mb-4 h-3 w-20 rounded bg-muted" />
        <div className="h-7 w-24 rounded bg-muted" />
      </div>
    );
  }

  const up = changePercent != null && changePercent > 0;
  const down = changePercent != null && changePercent < 0;
  const good = invertColors ? down : up;
  const bad = invertColors ? up : down;

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {changePercent != null && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${
              good ? "text-emerald-500" : bad ? "text-red-500" : "text-muted-foreground"
            }`}
          >
            {up ? <ArrowUp className="h-3 w-3" /> : down ? <ArrowDown className="h-3 w-3" /> : null}
            {Math.abs(changePercent).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xl font-black tabular-nums tracking-tight">{value}</p>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {compare && previousValue ? (
        <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3 text-[11px]">
          <span className="text-muted-foreground">{compare}</span>
          <span className="font-medium tabular-nums">{previousValue}</span>
        </div>
      ) : null}
    </div>
  );
}

export function AnalyticsMetricCards({
  gsc,
  prevGsc,
  ga4,
  prevGa4,
  gscLoading,
  ga4Loading,
  gscConnected,
  ga4Connected,
  days,
}: {
  gsc: GscTotals | null;
  prevGsc: GscTotals | null;
  ga4: Ga4Overview | null;
  prevGa4: Ga4Overview | null;
  gscLoading: boolean;
  ga4Loading: boolean;
  gscConnected: boolean;
  ga4Connected: boolean;
  days: number;
}) {
  const compare = comparisonLabel(days);
  const gscCards = [
    {
      title: "Clicks",
      value: gscConnected && gsc ? formatNumber(gsc.clicks) : "—",
      subtitle: "From Google Search",
      icon: MousePointer,
      tone: "bg-emerald-500/10 text-emerald-600",
      change: gsc && prevGsc ? percentChange(gsc.clicks, prevGsc.clicks) : null,
      previous: gsc && prevGsc ? formatNumber(prevGsc.clicks) : null,
    },
    {
      title: "Impressions",
      value: gscConnected && gsc ? formatNumber(gsc.impressions) : "—",
      subtitle: "Times you appeared",
      icon: Eye,
      tone: "bg-sky-500/10 text-sky-600",
      change: gsc && prevGsc ? percentChange(gsc.impressions, prevGsc.impressions) : null,
      previous: gsc && prevGsc ? formatNumber(prevGsc.impressions) : null,
    },
    {
      title: "Avg Position",
      value: gscConnected && gsc ? gsc.position.toFixed(1) : "—",
      subtitle: "Average search rank",
      icon: Target,
      tone: "bg-amber-500/10 text-amber-600",
      change: gsc && prevGsc ? percentChange(gsc.position, prevGsc.position) : null,
      previous: gsc && prevGsc ? prevGsc.position.toFixed(1) : null,
      invert: true,
    },
    {
      title: "CTR",
      value: gscConnected && gsc ? `${(gsc.ctr * 100).toFixed(2)}%` : "—",
      subtitle: "Click-through rate",
      icon: Percent,
      tone: "bg-violet-500/10 text-violet-600",
      change: gsc && prevGsc ? percentChange(gsc.ctr, prevGsc.ctr) : null,
      previous: gsc && prevGsc ? `${(prevGsc.ctr * 100).toFixed(2)}%` : null,
    },
  ];

  const ga4Cards = [
    {
      title: "Users",
      value: ga4Connected && ga4 ? formatNumber(ga4.users) : "—",
      subtitle: "Active users",
      icon: Users,
      tone: "bg-pink-500/10 text-pink-600",
      change: ga4 && prevGa4 ? percentChange(ga4.users, prevGa4.users) : null,
      previous: ga4 && prevGa4 ? formatNumber(prevGa4.users) : null,
    },
    {
      title: "Sessions",
      value: ga4Connected && ga4 ? formatNumber(ga4.sessions) : "—",
      subtitle: "Total sessions",
      icon: BarChart3,
      tone: "bg-indigo-500/10 text-indigo-600",
      change: ga4 && prevGa4 ? percentChange(ga4.sessions, prevGa4.sessions) : null,
      previous: ga4 && prevGa4 ? formatNumber(prevGa4.sessions) : null,
    },
    {
      title: "Views",
      value: ga4Connected && ga4 ? formatNumber(ga4.pageviews) : "—",
      subtitle: "Page views",
      icon: View,
      tone: "bg-teal-500/10 text-teal-600",
      change: ga4 && prevGa4 ? percentChange(ga4.pageviews, prevGa4.pageviews) : null,
      previous: ga4 && prevGa4 ? formatNumber(prevGa4.pageviews) : null,
    },
    {
      title: "Bounce Rate",
      value: ga4Connected && ga4 ? `${(ga4.bounceRate * 100).toFixed(1)}%` : "—",
      subtitle: "Average bounce rate",
      icon: TrendingDown,
      tone: "bg-orange-500/10 text-orange-600",
      change: ga4 && prevGa4 ? percentChange(ga4.bounceRate, prevGa4.bounceRate) : null,
      previous: ga4 && prevGa4 ? `${(prevGa4.bounceRate * 100).toFixed(1)}%` : null,
      invert: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {gscCards.map((card) => (
          <MetricCard
            key={card.title}
            title={card.title}
            value={card.value}
            subtitle={card.subtitle}
            icon={card.icon}
            tone={card.tone}
            loading={gscLoading}
            changePercent={card.change}
            previousValue={card.previous}
            compare={compare}
            invertColors={card.invert}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ga4Cards.map((card) => (
          <MetricCard
            key={card.title}
            title={card.title}
            value={card.value}
            subtitle={card.subtitle}
            icon={card.icon}
            tone={card.tone}
            loading={ga4Loading}
            changePercent={card.change}
            previousValue={card.previous}
            compare={compare}
            invertColors={card.invert}
          />
        ))}
      </div>
    </div>
  );
}
