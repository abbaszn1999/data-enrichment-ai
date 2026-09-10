"use client";

import { AnalyticsMetricCards } from "./metric-cards";
import { AnalyticsPagesTable } from "./pages-table";
import { AnalyticsTimeSeriesChart } from "./time-series-chart";
import type { Ga4Overview, Ga4PageRow, Ga4TimeSeriesRow, GscPageRow, GscTimeSeriesRow, GscTotals } from "@/lib/analytics/types";

export function AnalyticsOverviewPanel({
  days,
  gscTotals,
  prevGscTotals,
  ga4Overview,
  prevGa4Overview,
  gscPages,
  ga4Pages,
  gscTimeSeries,
  ga4TimeSeries,
  gscLoading,
  ga4Loading,
  gscReady,
  ga4Ready,
  siteProperty,
}: {
  days: number;
  gscTotals: GscTotals | null;
  prevGscTotals: GscTotals | null;
  ga4Overview: Ga4Overview | null;
  prevGa4Overview: Ga4Overview | null;
  gscPages: GscPageRow[];
  ga4Pages: Ga4PageRow[];
  gscTimeSeries: GscTimeSeriesRow[];
  ga4TimeSeries: Ga4TimeSeriesRow[];
  gscLoading: boolean;
  ga4Loading: boolean;
  gscReady: boolean;
  ga4Ready: boolean;
  siteProperty?: string | null;
}) {
  return (
    <div className="space-y-5">
      <AnalyticsMetricCards
        gsc={gscTotals}
        prevGsc={prevGscTotals}
        ga4={ga4Overview}
        prevGa4={prevGa4Overview}
        gscLoading={gscLoading}
        ga4Loading={ga4Loading}
        gscConnected={gscReady}
        ga4Connected={ga4Ready}
        days={days}
      />
      <AnalyticsTimeSeriesChart
        gsc={gscTimeSeries}
        ga4={ga4TimeSeries}
        loading={gscLoading || ga4Loading}
        gscConnected={gscReady}
        ga4Connected={ga4Ready}
      />
      <AnalyticsPagesTable
        gscPages={gscPages}
        ga4Pages={ga4Pages}
        gscLoading={gscLoading}
        ga4Loading={ga4Loading}
        gscConnected={gscReady}
        ga4Connected={ga4Ready}
        siteProperty={siteProperty}
      />
    </div>
  );
}
