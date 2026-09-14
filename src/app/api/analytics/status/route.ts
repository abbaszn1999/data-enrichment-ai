import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess } from "@/lib/analytics/access";
import { getAnalyticsConnection, toPublicConnection } from "@/lib/analytics/connections";
import { googleAnalyticsOAuthConfigured } from "@/lib/analytics/oauth";
import { fetchWithServerCache } from "@/lib/analytics/cache";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || "";
    const force = url.searchParams.get("force") === "1";
    const { admin } = await requireAnalyticsAccess(workspaceId);

    const cacheKey = `status:${workspaceId}`;
    const data = await fetchWithServerCache(
      cacheKey,
      async () => {
        const [gsc, ga4] = await Promise.all([
          getAnalyticsConnection(admin, workspaceId, "search-console"),
          getAnalyticsConnection(admin, workspaceId, "google-analytics"),
        ]);
        return {
          configured: googleAnalyticsOAuthConfigured(),
          gsc: toPublicConnection(gsc),
          ga4: toPublicConnection(ga4),
        };
      },
      60 * 1000, // 1 minute status cache
      force
    );

    return NextResponse.json(data);
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}
