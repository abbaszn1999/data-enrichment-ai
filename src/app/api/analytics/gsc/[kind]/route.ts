import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess, AnalyticsHttpError } from "@/lib/analytics/access";
import { getValidAnalyticsAccessToken } from "@/lib/analytics/connections";
import { fetchWithServerCache } from "@/lib/analytics/cache";
import {
  mapGscPages,
  mapGscTimeSeries,
  mapGscTotals,
  querySearchConsole,
} from "@/lib/analytics/google-api";
import {
  parseAnalyticsPageTypeParam,
  queryFilteredGscPages,
  queryFilteredGscTimeSeries,
  queryFilteredGscTotals,
  requireAnalyticsRuleConfig,
} from "@/lib/analytics/filtered";

export const maxDuration = 60;

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
      "search-console"
    );
    if (!connection.selected_property) {
      throw new AnalyticsHttpError(400, "Search Console property not selected");
    }

    const pageType = parseAnalyticsPageTypeParam(url.searchParams.get("pageType"));
    const rules = pageType
      ? await requireAnalyticsRuleConfig(admin, workspaceId, pageType)
      : null;
    const siteUrl = connection.selected_property;

    const cacheKey = `gsc:${workspaceId}:${kind}:${siteUrl}:${startDate}:${endDate}:${pageType || "all"}`;

    if (kind === "totals") {
      const data = await fetchWithServerCache(
        cacheKey,
        async () => {
          if (rules) {
            return {
              totals: await queryFilteredGscTotals(token, siteUrl, startDate, endDate, rules),
            };
          }
          try {
            const rows = await querySearchConsole(token, siteUrl, startDate, endDate, []);
            return { totals: mapGscTotals(rows) };
          } catch {
            const pages = await querySearchConsole(token, siteUrl, startDate, endDate, ["page"]);
            return { totals: mapGscTotals(pages) };
          }
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
              rows: await queryFilteredGscPages(token, siteUrl, startDate, endDate, rules),
            };
          }
          const rows = await querySearchConsole(token, siteUrl, startDate, endDate, ["page"]);
          return { rows: mapGscPages(rows) };
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
              rows: await queryFilteredGscTimeSeries(token, siteUrl, startDate, endDate, rules),
            };
          }
          const rows = await querySearchConsole(token, siteUrl, startDate, endDate, ["date"]);
          return { rows: mapGscTimeSeries(rows) };
        },
        5 * 60 * 1000,
        force
      );
      return NextResponse.json(data);
    }

    throw new AnalyticsHttpError(400, "Invalid GSC data type");
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}
