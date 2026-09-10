"use client";

import { AnalyticsOverviewPanel } from "@/components/analytics/overview-panel";
import { AnalyticsShell } from "@/components/analytics/analytics-shell";

export default function AnalyticsOverviewPage() {
  return (
    <AnalyticsShell page="overview">
      {({ analytics, gscReady, ga4Ready, range }) => (
        <AnalyticsOverviewPanel
          days={Number(range)}
          gscTotals={analytics.gscTotals}
          prevGscTotals={analytics.prevGscTotals}
          ga4Overview={analytics.ga4Overview}
          prevGa4Overview={analytics.prevGa4Overview}
          gscPages={analytics.gscPages}
          ga4Pages={analytics.ga4Pages}
          gscTimeSeries={analytics.gscTimeSeries}
          ga4TimeSeries={analytics.ga4TimeSeries}
          gscLoading={analytics.gscLoading}
          ga4Loading={analytics.ga4Loading}
          gscReady={gscReady}
          ga4Ready={ga4Ready}
          siteProperty={analytics.status.gsc.property}
        />
      )}
    </AnalyticsShell>
  );
}
