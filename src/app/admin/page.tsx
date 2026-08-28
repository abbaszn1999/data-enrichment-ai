"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CreditCard, Users } from "lucide-react";
import { AttentionList } from "@/components/platform-admin/attention-list";
import { OverviewHealthCard } from "@/components/platform-admin/overview-health-card";
import { OverviewHeroBand } from "@/components/platform-admin/overview-hero-card";
import { OverviewPulseStrip } from "@/components/platform-admin/overview-pulse-strip";
import { OverviewSpendChart } from "@/components/platform-admin/overview-spend-chart";
import { OverviewSpendMix } from "@/components/platform-admin/overview-spend-mix";
import { PageHeader } from "@/components/platform-admin/page-header";
import { RangePills } from "@/components/platform-admin/range-pills";
import { PageLoader } from "@/components/brand/page-loader";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatCredits, formatUsd } from "@/lib/platform-admin/format";
import { halfPeriodDeltaPercent } from "@/lib/platform-admin/overview-delta";
import type { LiveOverviewPayload } from "@/lib/platform-admin/live-types";
import type { AdminKpi, AdminOverviewRange } from "@/lib/platform-admin/types";
import { cn } from "@/lib/utils";

function kpiOf(kpis: AdminKpi[], label: string): AdminKpi | undefined {
  return kpis.find((kpi) => kpi.label === label);
}

export default function AdminOverviewPage() {
  const [range, setRange] = useState<AdminOverviewRange>("30d");
  const [data, setData] = useState<LiveOverviewPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminJson<LiveOverviewPayload>(`/api/platform-admin/overview?range=${range}`)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError("");
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const series = data?.series ?? [];
  const creditDelta = useMemo(
    () => halfPeriodDeltaPercent(series.map((point) => point.creditUsd)),
    [series]
  );
  const walletDelta = useMemo(
    () => halfPeriodDeltaPercent(series.map((point) => point.walletUsd)),
    [series]
  );

  const mrr = data ? kpiOf(data.kpis, "MRR (plans)") : undefined;
  const creditsSpent = data ? kpiOf(data.kpis, "Credits spent") : undefined;
  const walletSpent = data ? kpiOf(data.kpis, "Wallet spent") : undefined;
  const strip = data
    ? data.kpis
        .filter((kpi) => ["Users", "Workspaces", "Active plans", "Jobs failed"].includes(kpi.label))
        .map((kpi) => ({
          ...kpi,
          icon:
            kpi.label === "Workspaces"
              ? Building2
              : kpi.label === "Active plans"
                ? CreditCard
                : kpi.label === "Jobs failed"
                  ? AlertTriangle
                  : Users,
        }))
    : [];
  const creditUsdTotal = series.reduce((sum, point) => sum + point.creditUsd, 0);

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            Overview
            <span className="inline-flex h-5 items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              Live
            </span>
          </span>
        }
        description="Credits, wallet USD, jobs, and alerts. Same live data as the rest of this console."
        actions={<RangePills value={range} onChange={setRange} />}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading && !data ? (
        <PageLoader label="Loading overview" />
      ) : data ? (
        <div className={cn("space-y-5", loading && "pointer-events-none opacity-70")}>
          <OverviewHeroBand
            items={[
              { label: "MRR", value: mrr?.value ?? "—", hint: mrr?.hint },
              {
                label: "Credits spent",
                value: creditsSpent?.value ?? "—",
                hint: `${formatUsd(creditUsdTotal)} at $0.30 / credit`,
                delta: creditDelta,
              },
              {
                label: "Wallet spent",
                value: walletSpent?.value ?? "—",
                hint: walletSpent?.hint,
                delta: walletDelta,
              },
            ]}
          />

          <OverviewPulseStrip items={strip} />

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <OverviewSpendChart series={series} />
            </div>
            <OverviewHealthCard
              health={data.jobHealth}
              slices={data.creditSlices}
              attentionCount={data.attention.length}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <OverviewSpendMix
              title="AI credit mix"
              unit="credits"
              slices={data.creditSlices}
              formatValue={formatCredits}
            />
            <OverviewSpendMix
              title="Wallet mix"
              unit="USD"
              slices={data.walletSlices}
              formatValue={formatUsd}
            />
          </div>

          <AttentionList items={data.attention} />
        </div>
      ) : null}
    </>
  );
}
