"use client";

import { AnalyticsOverviewPanel } from "@/components/analytics/overview-panel";
import { AnalyticsShell } from "@/components/analytics/analytics-shell";
import { AnalyticsRulesBanner, AnalyticsRulesEmpty } from "@/components/analytics/rules-banner";
import type { AnalyticsPageType } from "@/lib/analytics/types";

export function AnalyticsFilteredPage({ page }: { page: AnalyticsPageType }) {
  return (
    <AnalyticsShell page={page} pageType={page}>
      {({ analytics, gscReady, ga4Ready, range, canManage, openRules }) => {
        if (analytics.rulesLoading) {
          return (
            <div className="animate-pulse rounded-2xl border border-border/60 bg-card p-8">
              <div className="mx-auto h-4 w-48 rounded bg-muted" />
              <div className="mx-auto mt-3 h-3 w-80 rounded bg-muted" />
            </div>
          );
        }
        if (!analytics.rules) {
          return (
            <AnalyticsRulesEmpty pageType={page} canManage={canManage} onSetup={openRules} />
          );
        }
        return (
          <div className="space-y-5">
            <AnalyticsRulesBanner rules={analytics.rules} />
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
          </div>
        );
      }}
    </AnalyticsShell>
  );
}
