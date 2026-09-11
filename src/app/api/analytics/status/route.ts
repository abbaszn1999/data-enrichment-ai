import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess } from "@/lib/analytics/access";
import { getAnalyticsConnection, toPublicConnection } from "@/lib/analytics/connections";
import { googleAnalyticsOAuthConfigured } from "@/lib/analytics/oauth";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") || "";
    const { admin } = await requireAnalyticsAccess(workspaceId);
    const [gsc, ga4] = await Promise.all([
      getAnalyticsConnection(admin, workspaceId, "search-console"),
      getAnalyticsConnection(admin, workspaceId, "google-analytics"),
    ]);
    return NextResponse.json({
      configured: googleAnalyticsOAuthConfigured(),
      gsc: toPublicConnection(gsc),
      ga4: toPublicConnection(ga4),
    });
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}
