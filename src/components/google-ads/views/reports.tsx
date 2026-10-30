"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bot, CalendarClock, Lightbulb, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SEGMENTS, segmentRows, type SegmentRow } from "@/lib/google-ads/analytics";
import { METRICS, addDays, derive, formatMetric } from "@/lib/google-ads/metrics";
import { gid } from "@/lib/google-ads/mutations";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { MetricKey, ScheduledReport, SegmentKey } from "@/lib/google-ads/types";
import { metricColumns } from "../ga-columns";
import { GaChart } from "../ga-chart";
import { GaTable, type GaColumn } from "../ga-table";
import { Card, Pill, SelectBox, ViewHeader } from "../ga-ui";
import { scopedCampaignIds, useGa } from "../use-ga";

const CHART_METRICS: MetricKey[] = ["cost", "conversions", "conversionsValue", "roas", "cpa", "clicks", "impressions", "ctr", "convRate"];

/** Follow-up the agent can act on for a given segment. */
const SEGMENT_PROMPT: Partial<Record<SegmentKey, string>> = {
  hour: "When do my ads perform best? Adjust my ad schedule",
  dayOfWeek: "When do my ads perform best? Adjust my ad schedule",
  device: "Compare mobile vs desktop and set device bid adjustments",
  age: "Which age groups and genders convert best?",
  gender: "Which age groups and genders convert best?",
};

export function ReportsView() {
  const { acc, data, range, currency, campaign } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [segment, setSegment] = useState<SegmentKey>("device");
  const [metric, setMetric] = useState<MetricKey>("conversions");
  const ids = useMemo(() => scopedCampaignIds(data, campaign), [data, campaign]);
  const rows = useMemo(() => segmentRows(data, range, segment, ids), [data, range, segment, ids]);
  const timeSeries = segment === "day" || segment === "week";

  const insight = useMemo(() => bestWorst(rows, currency), [rows, currency]);

  const schedule = () => {
    const report: ScheduledReport = {
      id: gid("sr"),
      name: `${SEGMENTS[segment].label} report${campaign ? ` · ${campaign.name}` : ""}`,
      segment,
      metrics: ["cost", "conversions", "conversionsValue", "roas"],
      frequency: "WEEKLY",
      recipients: ["owner@stride-demo.com"],
      format: "PDF",
      nextRun: addDays(new Date().toISOString().slice(0, 10), 7),
    };
    const res = applyDirect(`Schedule "${report.name}"`, [{ kind: "collection.upsert", collection: "scheduledReports", items: [report] }]);
    if (res.ok) toast.success("Report scheduled weekly");
  };

  const columns: GaColumn<SegmentRow>[] = [
    { id: "label", header: SEGMENTS[segment].label, label: SEGMENTS[segment].label, sticky: true, sortValue: (r) => (timeSeries || segment === "hour" || segment === "dayOfWeek" ? r.key : r.label), csv: (r) => r.label, render: (r) => <span className="font-semibold">{r.label}</span> },
    {
      id: "share",
      header: "Share of cost",
      label: "Share of cost",
      hideable: true,
      sortValue: (r) => r.metrics.cost,
      render: (r) => {
        const total = rows.reduce((s, x) => s + x.metrics.cost, 0) || 1;
        return (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-[#400095] dark:bg-violet-500" style={{ width: `${(r.metrics.cost / total) * 100}%` }} />
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{((r.metrics.cost / total) * 100).toFixed(1)}%</span>
          </span>
        );
      },
    },
    ...metricColumns<SegmentRow>((r) => r.metrics, currency, { totals: derive(rows.reduce((s, r) => ({ impressions: s.impressions + r.base.impressions, clicks: s.clicks + r.base.clicks, cost: s.cost + r.base.cost, conversions: s.conversions + r.base.conversions, conversionsValue: s.conversionsValue + r.base.conversionsValue }), { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 })) }),
  ];

  return (
    <div className="space-y-4">
      <ViewHeader title="Reports" subtitle={`Break performance down to see where you win and lose${campaign ? ` · ${campaign.name}` : " · all campaigns"}.`} />

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SEGMENTS) as SegmentKey[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSegment(s)}
            title={SEGMENTS[s].hint}
            className={cn("rounded-full border px-3 py-1.5 text-xs", segment === s ? "border-[#400095] bg-[#400095] font-semibold text-white dark:border-violet-500 dark:bg-violet-600" : "border-border/70 text-muted-foreground hover:text-foreground")}
          >
            {SEGMENTS[s].label}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold">{METRICS[metric].label} by {SEGMENTS[segment].label.toLowerCase()}</p>
          <SelectBox value={metric} onChange={setMetric} options={CHART_METRICS.map((m) => ({ value: m, label: METRICS[m].label }))} className="ml-auto w-44" />
        </div>
        {timeSeries ? (
          <GaChart points={rows.map((r) => ({ date: r.key, ...r.metrics }))} primary={metric} currency={currency} />
        ) : (
          <SegmentBars rows={rows} metric={metric} currency={currency} />
        )}
      </Card>

      {insight && (
        <Card className="flex flex-wrap items-start gap-3 border-amber-500/30 bg-amber-500/[0.04] p-4">
          <Lightbulb className="mt-0.5 h-5 w-5 text-amber-600" />
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="font-semibold">{insight.title}</p>
            <p className="text-muted-foreground">{insight.body}</p>
          </div>
          {SEGMENT_PROMPT[segment] && (
            <button type="button" onClick={() => runAgentTurn(SEGMENT_PROMPT[segment]!)} className="inline-flex items-center gap-1 rounded-lg bg-[#400095]/10 px-3 py-1.5 text-[11px] font-semibold text-[#400095] hover:bg-[#400095]/15 dark:bg-violet-500/15 dark:text-violet-300">
              <Bot className="h-3.5 w-3.5" /> Act on this with the agent
            </button>
          )}
        </Card>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={schedule} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-semibold hover:bg-muted">
          <CalendarClock className="h-3.5 w-3.5" /> Email this report weekly
        </button>
      </div>
      <GaTable rows={rows} columns={columns} rowKey={(r) => r.key} exportName={`report-${segment}`} />

      <Card className="p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-bold"><Mail className="h-4 w-4 text-muted-foreground" /> Scheduled reports</p>
        {acc.data.scheduledReports.length ? (
          acc.data.scheduledReports.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-border/50 py-2.5 text-xs first:border-t-0">
              <span className="font-semibold">{r.name}</span>
              <Pill>{r.frequency.toLowerCase()}</Pill>
              <Pill>{r.format}</Pill>
              <span className="text-muted-foreground">to {r.recipients.join(", ")} · next {r.nextRun}</span>
              <button type="button" onClick={() => applyDirect(`Delete scheduled report "${r.name}"`, [{ kind: "collection.remove", collection: "scheduledReports", ids: [r.id] }])} className="ml-auto rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-600" aria-label="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No scheduled reports.</p>
        )}
      </Card>
    </div>
  );
}

function SegmentBars({ rows, metric, currency }: { rows: SegmentRow[]; metric: MetricKey; currency: string }) {
  const { resolvedTheme } = useTheme();
  const axis = resolvedTheme === "dark" ? "#a1a1aa" : "#71717a";
  const data = rows.map((r) => ({ label: r.label, value: r.metrics[metric] }));
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: axis }} tickLine={false} axisLine={false} interval={0} angle={rows.length > 8 ? -35 : 0} textAnchor={rows.length > 8 ? "end" : "middle"} height={rows.length > 8 ? 50 : 30} />
          <YAxis tick={{ fontSize: 10, fill: axis }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatMetric(metric, v, currency)} />
          <Tooltip
            cursor={{ fill: "rgba(64,0,149,0.06)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                  <p className="font-semibold">{(payload[0].payload as { label: string }).label}</p>
                  <p className="text-muted-foreground">{METRICS[metric].label}: <span className="font-semibold text-foreground">{formatMetric(metric, Number(payload[0].value), currency)}</span></p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="value" fill={METRICS[metric].color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function bestWorst(rows: SegmentRow[], currency: string): { title: string; body: string } | null {
  const valid = rows.filter((r) => r.metrics.cost > 0 && r.metrics.conversions > 0.5);
  if (valid.length < 2) return null;
  const byRoas = [...valid].sort((a, b) => b.metrics.roas - a.metrics.roas);
  const best = byRoas[0];
  const worst = byRoas[byRoas.length - 1];
  return {
    title: `${best.label} returns ${best.metrics.roas.toFixed(2)}x, ${worst.label} only ${worst.metrics.roas.toFixed(2)}x`,
    body: `${best.label} converts at ${formatMetric("cpa", best.metrics.cpa, currency)} per conversion vs ${formatMetric("cpa", worst.metrics.cpa, currency)} for ${worst.label}. Shifting bids toward ${best.label} usually raises return at the same spend.`,
  };
}
