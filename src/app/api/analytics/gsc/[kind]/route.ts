import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess, AnalyticsHttpError } from "@/lib/analytics/access";
import { getValidAnalyticsAccessToken } from "@/lib/analytics/connections";
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

    if (kind === "totals") {
      if (rules) {
        return NextResponse.json({
          totals: await queryFilteredGscTotals(token, siteUrl, startDate, endDate, rules),
        });
      }
      try {
        const rows = await querySearchConsole(token, siteUrl, startDate, endDate, []);
        return NextResponse.json({ totals: mapGscTotals(rows) });
      } catch {
        const pages = await querySearchConsole(token, siteUrl, startDate, endDate, ["page"]);
        return NextResponse.json({ totals: mapGscTotals(pages) });
      }
    }
    if (kind === "pages") {
      if (rules) {
        return NextResponse.json({
          rows: await queryFilteredGscPages(token, siteUrl, startDate, endDate, rules),
        });
      }
      const rows = await querySearchConsole(token, siteUrl, startDate, endDate, ["page"]);
      return NextResponse.json({ rows: mapGscPages(rows) });
    }
    if (kind === "timeseries") {
      if (rules) {
        return NextResponse.json({
          rows: await queryFilteredGscTimeSeries(token, siteUrl, startDate, endDate, rules),
        });
      }
      const rows = await querySearchConsole(token, siteUrl, startDate, endDate, ["date"]);
      return NextResponse.json({ rows: mapGscTimeSeries(rows) });
    }
    throw new AnalyticsHttpError(400, "Invalid GSC data type");
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}
