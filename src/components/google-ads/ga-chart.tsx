"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { METRICS, formatMetric } from "@/lib/google-ads/metrics";
import type { MetricKey, Metrics } from "@/lib/google-ads/types";

type Point = Metrics & { date: string };

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function GaChart({ points, primary, secondary, currency, height = 240 }: { points: Point[]; primary: MetricKey; secondary?: MetricKey; currency: string; height?: number }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const grid = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const axis = dark ? "#a1a1aa" : "#71717a";
  const pColor = METRICS[primary].color;
  const sColor = secondary ? METRICS[secondary].color : undefined;
  const gradientId = `ga-fill-${primary}`;

  const data = useMemo(() => points.map((p) => ({ ...p, label: shortDate(p.date) })), [points]);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pColor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={pColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: axis }} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis
            yAxisId="p"
            tick={{ fontSize: 10, fill: axis }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatMetric(primary, v, currency)}
          />
          {secondary && (
            <YAxis
              yAxisId="s"
              orientation="right"
              tick={{ fontSize: 10, fill: axis }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => formatMetric(secondary, v, currency)}
            />
          )}
          <Tooltip
            cursor={{ stroke: axis, strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Point;
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                  <p className="mb-1 font-semibold">{label}</p>
                  {[primary, secondary].filter((k): k is MetricKey => !!k).map((k) => (
                    <p key={k} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: METRICS[k].color }} />
                      <span className="text-muted-foreground">{METRICS[k].label}</span>
                      <span className="ml-auto pl-3 font-semibold tabular-nums">{formatMetric(k, row[k], currency)}</span>
                    </p>
                  ))}
                </div>
              );
            }}
          />
          <Area yAxisId="p" type="monotone" dataKey={primary} stroke={pColor} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 3 }} />
          {secondary && <Line yAxisId="s" type="monotone" dataKey={secondary} stroke={sColor} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
