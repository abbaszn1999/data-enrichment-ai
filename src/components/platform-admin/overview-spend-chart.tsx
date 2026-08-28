"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { OverviewCard, OverviewPanelHeader } from "@/components/platform-admin/overview-card";
import { formatUsd } from "@/lib/platform-admin/format";
import type { OverviewDayPoint } from "@/lib/platform-admin/live-types";

const CREDIT = "#F76D01";
const WALLET_LIGHT = "#400095";
const WALLET_DARK = "#D4D4D8";

function formatAxisUsd(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  if (value > 0 && value < 1) return `$${value.toFixed(2)}`;
  return `$${Math.round(value)}`;
}

function formatTickDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function ChartTooltip({
  active,
  payload,
  label,
  walletColor,
}: {
  active?: boolean;
  payload?: { dataKey?: string; value?: number }[];
  label?: string;
  walletColor: string;
}) {
  if (!active || !payload?.length) return null;
  const credit = payload.find((item) => item.dataKey === "creditUsd")?.value ?? 0;
  const wallet = payload.find((item) => item.dataKey === "walletUsd")?.value ?? 0;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-sm">
      <p className="mb-1.5 font-medium text-muted-foreground">{label ? formatTickDate(label) : ""}</p>
      <p className="tabular-nums" style={{ color: CREDIT }}>
        AI credits ($0.30) {formatUsd(credit)}
      </p>
      <p className="tabular-nums" style={{ color: walletColor }}>
        Wallet {formatUsd(wallet)}
      </p>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function OverviewSpendChart({ series }: { series: OverviewDayPoint[] }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const walletStroke = dark ? WALLET_DARK : WALLET_LIGHT;
  const grid = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
  const tick = dark ? "#A1A1AA" : "#71717A";
  const empty = series.every((point) => point.creditUsd === 0 && point.walletUsd === 0);

  return (
    <OverviewCard className="h-full">
      <OverviewPanelHeader
        title="Spend over time"
        hint="Wallet USD and AI credits at $0.30 each"
        action={
          <div className="flex gap-3">
            <LegendDot color={CREDIT} label="AI credits" />
            <LegendDot color={walletStroke} label="Wallet USD" />
          </div>
        }
      />
      {empty ? (
        <div className="flex h-[280px] items-center justify-center px-4 text-sm text-muted-foreground">
          No spend in this range.
        </div>
      ) : (
        <div className="h-[280px] w-full px-2 pb-3 pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="overviewCreditFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CREDIT} stopOpacity={dark ? 0.28 : 0.22} />
                  <stop offset="100%" stopColor={CREDIT} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="overviewWalletFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={walletStroke} stopOpacity={dark ? 0.16 : 0.18} />
                  <stop offset="100%" stopColor={walletStroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={grid} strokeDasharray="4 8" />
              <XAxis
                dataKey="date"
                tickFormatter={formatTickDate}
                tick={{ fontSize: 11, fill: tick }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={formatAxisUsd}
                tick={{ fontSize: 11, fill: tick }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip
                cursor={{ stroke: grid, strokeWidth: 1 }}
                content={<ChartTooltip walletColor={walletStroke} />}
              />
              <Area
                type="monotone"
                dataKey="walletUsd"
                name="Wallet USD"
                stroke={walletStroke}
                fill="url(#overviewWalletFill)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
              <Area
                type="monotone"
                dataKey="creditUsd"
                name="AI credits"
                stroke={CREDIT}
                fill="url(#overviewCreditFill)"
                strokeWidth={2.25}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: CREDIT }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </OverviewCard>
  );
}
