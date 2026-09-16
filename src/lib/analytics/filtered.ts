import { AnalyticsHttpError } from "./access";
import {
  mapGa4Overview,
  mapGa4Pages,
  mapGa4TimeSeries,
  mapGscPages,
  mapGscTimeSeries,
  mapGscTotals,
  querySearchConsole,
  runGa4Report,
  GA4_OVERVIEW_METRICS,
  GA4_PAGE_METRICS,
} from "./google-api";
import { buildGa4FilterExpression, buildGscDimensionFilterGroups, filterPagesByRules } from "./rules";
import { getAnalyticsRules } from "./rules-store";
import { isAnalyticsPageType, type AnalyticsPageType, type AnalyticsRuleConfig, type GscTotals } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

const EMPTY_GSC_TOTALS: GscTotals = {
  clicks: 0,
  impressions: 0,
  ctr: 0,
  position: 0,
};

export function parseAnalyticsPageTypeParam(value: string | null): AnalyticsPageType | null {
  if (!value) return null;
  if (!isAnalyticsPageType(value)) {
    throw new AnalyticsHttpError(400, "Invalid pageType");
  }
  return value;
}

export async function requireAnalyticsRuleConfig(
  admin: SupabaseClient,
  workspaceId: string,
  pageType: AnalyticsPageType
): Promise<AnalyticsRuleConfig> {
  const rules = await getAnalyticsRules(admin, workspaceId, pageType);
  if (!rules) {
    throw new AnalyticsHttpError(
      400,
      `${pageType === "plp" ? "PLP" : "Products"} rules are not configured yet.`
    );
  }
  return rules;
}

export async function queryFilteredGscPages(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  rules: AnalyticsRuleConfig
) {
  const groups = buildGscDimensionFilterGroups(rules);
  if (groups === null) return [];
  const rows = await querySearchConsole(token, siteUrl, startDate, endDate, ["page"], groups);
  // Google already applied the page filter; keep a local pass so regex
  // pathname anchors stay consistent with the rule preview in the UI.
  return filterPagesByRules(mapGscPages(rows), rules);
}

export async function queryFilteredGscTotals(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  rules: AnalyticsRuleConfig
) {
  const groups = buildGscDimensionFilterGroups(rules);
  if (groups === null) return EMPTY_GSC_TOTALS;
  const rows = await querySearchConsole(token, siteUrl, startDate, endDate, [], groups);
  return mapGscTotals(rows);
}

export async function queryFilteredGscTimeSeries(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  rules: AnalyticsRuleConfig
) {
  const groups = buildGscDimensionFilterGroups(rules);
  if (groups === null) return [];
  // Date-only + a server-side page filter is what GSC's Performance chart
  // does. Fetching date×page and slicing locally hits the 25k row cap and
  // under-counts large catalogs.
  const rows = await querySearchConsole(token, siteUrl, startDate, endDate, ["date"], groups);
  return mapGscTimeSeries(rows);
}

export async function queryFilteredGa4Overview(
  token: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  rules: AnalyticsRuleConfig
) {
  const report = await runGa4Report(
    token,
    propertyId,
    startDate,
    endDate,
    [...GA4_OVERVIEW_METRICS],
    [],
    1,
    buildGa4FilterExpression(rules)
  );
  return mapGa4Overview(report);
}

export async function queryFilteredGa4Pages(
  token: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  rules: AnalyticsRuleConfig
) {
  const report = await runGa4Report(
    token,
    propertyId,
    startDate,
    endDate,
    [...GA4_PAGE_METRICS],
    ["pagePath"],
    100000,
    buildGa4FilterExpression(rules)
  );
  return filterPagesByRules(mapGa4Pages(report), rules);
}

export async function queryFilteredGa4TimeSeries(
  token: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  rules: AnalyticsRuleConfig
) {
  const report = await runGa4Report(
    token,
    propertyId,
    startDate,
    endDate,
    ["sessions"],
    ["date"],
    10000,
    buildGa4FilterExpression(rules)
  );
  return mapGa4TimeSeries(report);
}
