"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ga4DateToIso } from "@/lib/analytics/dates";
import type { Ga4TimeSeriesRow, GscTimeSeriesRow } from "@/lib/analytics/types";

const COLORS = {
  clicks: "#400095",
  impressions: "#0d9488",
  sessions: "#F76D01",
};

function formatTickDate(value: string): string {
  const date = new Date(`${ga4DateToIso(value)}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export function AnalyticsTimeSeriesChart({
  gsc,
  ga4,
  loading,
  gscConnected,
  ga4Connected,
}: {
  gsc: GscTimeSeriesRow[];
  ga4: Ga4TimeSeriesRow[];
  loading: boolean;
  gscConnected: boolean;
  ga4Connected: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState({ clicks: true, impressions: true, sessions: true });
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const grid = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
  const tick = dark ? "#A1A1AA" : "#71717A";

  const data = useMemo(() => {
    const byDate = new Map<string, { date: string; clicks: number; impressions: number; sessions: number }>();
    for (const row of gsc) {
      byDate.set(row.date, {
        date: row.date,
        clicks: row.clicks,
        impressions: row.impressions,
        sessions: 0,
      });
    }
    for (const row of ga4) {
      const date = ga4DateToIso(row.date);
      const current = byDate.get(date) ?? { date, clicks: 0, impressions: 0, sessions: 0 };
      current.sessions = row.sessions;
      byDate.set(date, current);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [ga4, gsc]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-bold">Performance over time</h3>
      {loading ? (
        <div className="h-[300px] animate-pulse rounded-xl bg-muted/60" />
      ) : !gscConnected && !ga4Connected ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          Connect Search Console or Analytics to see trends.
        </div>
      ) : data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          No data for this date range yet.
        </div>
      ) : (
        <>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatTickDate}
                  tick={{ fill: tick, fontSize: 11 }}
                  axisLine={{ stroke: grid }}
                  tickLine={{ stroke: grid }}
                  minTickGap={40}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: tick, fontSize: 11 }}
                  axisLine={{ stroke: grid }}
                  tickLine={{ stroke: grid }}
                  tickFormatter={formatNumber}
                  width={44}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: tick, fontSize: 11 }}
                  axisLine={{ stroke: grid }}
                  tickLine={{ stroke: grid }}
                  tickFormatter={formatNumber}
                  width={44}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-sm">
                        <p className="mb-1.5 font-medium text-muted-foreground">
                          {typeof label === "string" ? formatTickDate(label) : ""}
                        </p>
                        {payload.map((entry) => (
                          <p key={String(entry.dataKey)} className="tabular-nums" style={{ color: String(entry.color) }}>
                            {entry.name}: {formatNumber(Number(entry.value ?? 0))}
                          </p>
                        ))}
                      </div>
                    );
                  }}
                />
                {gscConnected && visible.clicks && (
                  <Line yAxisId="left" type="monotone" dataKey="clicks" name="Clicks" stroke={COLORS.clicks} strokeWidth={2} dot={false} />
                )}
                {gscConnected && visible.impressions && (
                  <Line yAxisId="right" type="monotone" dataKey="impressions" name="Impressions" stroke={COLORS.impressions} strokeWidth={2} dot={false} />
                )}
                {ga4Connected && visible.sessions && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="sessions"
                    name="Sessions"
                    stroke={COLORS.sessions}
                    strokeWidth={2}
                    dot={false}
                    strokeDasharray="5 5"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-4">
            {gscConnected && (
              <>
                <LegendToggle
                  label="Clicks"
                  color={COLORS.clicks}
                  active={visible.clicks}
                  onClick={() => setVisible((prev) => ({ ...prev, clicks: !prev.clicks }))}
                />
                <LegendToggle
                  label="Impressions"
                  color={COLORS.impressions}
                  active={visible.impressions}
                  onClick={() => setVisible((prev) => ({ ...prev, impressions: !prev.impressions }))}
                />
              </>
            )}
            {ga4Connected && (
              <LegendToggle
                label="Sessions"
                color={COLORS.sessions}
                active={visible.sessions}
                dashed
                onClick={() => setVisible((prev) => ({ ...prev, sessions: !prev.sessions }))}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LegendToggle({
  label,
  color,
  active,
  onClick,
  dashed,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
  dashed?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 text-[11px] font-medium">
      <span
        className="h-0.5 w-4 rounded"
        style={{
          background: active ? color : `${color}55`,
          backgroundImage: dashed
            ? `repeating-linear-gradient(90deg, ${active ? color : `${color}55`} 0 6px, transparent 6px 10px)`
            : undefined,
        }}
      />
      <span style={{ color: active ? color : undefined }} className={active ? "" : "text-muted-foreground"}>
        {label}
      </span>
    </button>
  );
}
