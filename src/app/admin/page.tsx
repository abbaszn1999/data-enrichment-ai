"use client";

import { useEffect, useState } from "react";
import { AttentionList } from "@/components/platform-admin/attention-list";
import { FilterSelect } from "@/components/platform-admin/filter-select";
import { KpiCard } from "@/components/platform-admin/kpi-card";
import { PageHeader } from "@/components/platform-admin/page-header";
import { SpendBars } from "@/components/platform-admin/spend-bars";
import { PageLoader } from "@/components/brand/page-loader";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatCredits, formatUsd } from "@/lib/platform-admin/format";
import { RANGE_LABELS } from "@/lib/platform-admin/labels";
import type { LiveOverviewPayload } from "@/lib/platform-admin/live-types";
import type { AdminOverviewRange } from "@/lib/platform-admin/types";

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

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live platform snapshot. Credits and wallet USD are tracked separately."
        actions={
          <FilterSelect
            label="Range"
            value={range}
            onChange={(value) => setRange(value as AdminOverviewRange)}
            options={(Object.keys(RANGE_LABELS) as AdminOverviewRange[]).map((key) => ({
              value: key,
              label: RANGE_LABELS[key],
            }))}
          />
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading && !data ? (
        <PageLoader label="Loading overview" />
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.kpis.map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SpendBars
              title="AI credit spend"
              unit="credits"
              slices={data.creditSlices}
              formatValue={formatCredits}
            />
            <SpendBars
              title="Wallet USD spend"
              unit="USD"
              slices={data.walletSlices}
              formatValue={formatUsd}
            />
          </div>

          <AttentionList items={data.attention} />
        </>
      ) : null}
    </>
  );
}
