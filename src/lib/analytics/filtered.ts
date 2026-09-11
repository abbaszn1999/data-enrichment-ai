import { AnalyticsHttpError } from "./access";
import { aggregateGscTimeSeriesByDate, totalsFromGscPages } from "./aggregate";
import {
  mapGa4Overview,
  mapGa4Pages,
  mapGa4TimeSeries,
  mapGscPages,
  querySearchConsole,
  runGa4Report,
  GA4_OVERVIEW_METRICS,
  GA4_PAGE_METRICS,
} from "./google-api";
import { buildGa4FilterExpression, filterPagesByRules } from "./rules";
import { getAnalyticsRules } from "./rules-store";
import { isAnalyticsPageType, type AnalyticsPageType, type AnalyticsRuleConfig } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  const rows = await querySearchConsole(token, siteUrl, startDate, endDate, ["page"]);
  return filterPagesByRules(mapGscPages(rows), rules);
}

export async function queryFilteredGscTotals(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  rules: AnalyticsRuleConfig
) {
  const pages = await queryFilteredGscPages(token, siteUrl, startDate, endDate, rules);
  return totalsFromGscPages(pages);
}

export async function queryFilteredGscTimeSeries(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  rules: AnalyticsRuleConfig
) {
  const rows = await querySearchConsole(token, siteUrl, startDate, endDate, ["date", "page"]);
  const mapped = rows.map((row) => ({
    date: row.keys?.[0] || "",
    page: row.keys?.[1] || "",
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
  }));
  return aggregateGscTimeSeriesByDate(filterPagesByRules(mapped, rules));
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
