"use client";

import { METRICS, formatMetric } from "@/lib/google-ads/metrics";
import type { MetricKey, Metrics } from "@/lib/google-ads/types";
import type { GaColumn } from "./ga-table";

/** Standard metric columns, in Google Ads' default order. */
export const DEFAULT_METRICS: MetricKey[] = ["impressions", "clicks", "ctr", "avgCpc", "cost", "conversions", "cpa", "conversionsValue", "roas"];

/** Extra metrics users can switch on from the column picker. */
const OPTIONAL_METRICS: MetricKey[] = ["convRate"];

export function metricColumns<T>(
  get: (row: T) => Metrics,
  currency: string,
  opts: { keys?: MetricKey[]; totals?: Metrics } = {}
): GaColumn<T>[] {
  const keys = opts.keys ?? [...DEFAULT_METRICS, ...OPTIONAL_METRICS];
  return keys.map((key) => ({
    label: METRICS[key].label,
    hideable: true,
    defaultHidden: OPTIONAL_METRICS.includes(key) && !opts.keys,
    csv: (row: T) => Math.round(get(row)[key] * 100) / 100,
    id: key,
    header: METRICS[key].short,
    align: "right" as const,
    sortValue: (row: T) => get(row)[key],
    render: (row: T) => {
      const value = get(row)[key];
      return value ? formatMetric(key, value, currency) : <span className="text-muted-foreground/60">{key === "cost" ? formatMetric(key, 0, currency) : "—"}</span>;
    },
    total: opts.totals ? formatMetric(key, opts.totals[key], currency) : undefined,
  }));
}
