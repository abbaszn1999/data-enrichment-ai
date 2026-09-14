import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess, AnalyticsHttpError } from "@/lib/analytics/access";
import { getValidAnalyticsAccessToken } from "@/lib/analytics/connections";
import { fetchWithServerCache } from "@/lib/analytics/cache";
import {
  GA4_OVERVIEW_METRICS,
  GA4_PAGE_METRICS,
  mapGa4Overview,
  mapGa4Pages,
  mapGa4TimeSeries,
  runGa4Report,
} from "@/lib/analytics/google-api";
import {
  parseAnalyticsPageTypeParam,
  queryFilteredGa4Overview,
  queryFilteredGa4Pages,
  queryFilteredGa4TimeSeries,
  requireAnalyticsRuleConfig,
} from "@/lib/analytics/filtered";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ kind: string }> }
) {
  try {
    const { kind } = await context.params;
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || "";
    const startDate = url.searchParams.get("startDate") || "";
    const endDate = url.searchParams.get("endDate") || "";
    const force = url.searchParams.get("force") === "1";
    if (!startDate || !endDate) {
      throw new AnalyticsHttpError(400, "Missing startDate or endDate");
    }
    const { admin } = await requireAnalyticsAccess(workspaceId);
    const { token, connection } = await getValidAnalyticsAccessToken(
      admin,
      workspaceId,
      "google-analytics"
    );
    if (!connection.selected_property) {
      throw new AnalyticsHttpError(400, "GA4 property not selected");
    }

    const pageType = parseAnalyticsPageTypeParam(url.searchParams.get("pageType"));
    const rules = pageType
      ? await requireAnalyticsRuleConfig(admin, workspaceId, pageType)
      : null;
    const propertyId = connection.selected_property;

    const cacheKey = `ga4:${workspaceId}:${kind}:${propertyId}:${startDate}:${endDate}:${pageType || "all"}`;

    if (kind === "overview") {
      const data = await fetchWithServerCache(
        cacheKey,
        async () => {
          if (rules) {
            return await queryFilteredGa4Overview(token, propertyId, startDate, endDate, rules);
          }
          const report = await runGa4Report(
            token,
            propertyId,
            startDate,
            endDate,
            [...GA4_OVERVIEW_METRICS]
          );
          return mapGa4Overview(report);
        },
        5 * 60 * 1000,
        force
      );
      return NextResponse.json(data);
    }

    if (kind === "pages") {
      const data = await fetchWithServerCache(
        cacheKey,
        async () => {
          if (rules) {
            return {
              rows: await queryFilteredGa4Pages(token, propertyId, startDate, endDate, rules),
            };
          }
          const report = await runGa4Report(
            token,
            propertyId,
            startDate,
            endDate,
            [...GA4_PAGE_METRICS],
            ["pagePath"]
          );
          return { rows: mapGa4Pages(report) };
        },
        5 * 60 * 1000,
        force
      );
      return NextResponse.json(data);
    }

    if (kind === "timeseries") {
      const data = await fetchWithServerCache(
        cacheKey,
        async () => {
          if (rules) {
            return {
              rows: await queryFilteredGa4TimeSeries(token, propertyId, startDate, endDate, rules),
            };
          }
          const report = await runGa4Report(
            token,
            propertyId,
            startDate,
            endDate,
            ["sessions"],
            ["date"]
          );
          return { rows: mapGa4TimeSeries(report) };
        },
        5 * 60 * 1000,
        force
      );
      return NextResponse.json(data);
    }

    throw new AnalyticsHttpError(400, "Invalid GA4 data type");
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}
