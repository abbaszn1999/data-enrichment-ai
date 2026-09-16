import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess, AnalyticsHttpError } from "@/lib/analytics/access";
import {
  getValidAnalyticsAccessToken,
  updateSelectedProperty,
} from "@/lib/analytics/connections";
import { listAnalyticsProperties, listSearchConsoleSites } from "@/lib/analytics/google-api";
import { isAnalyticsConnectionType, type AnalyticsPropertyOption } from "@/lib/analytics/types";
import {
  analyticsPropertiesCacheKey,
  fetchWithServerCache,
  invalidateServerAnalyticsCache,
} from "@/lib/analytics/cache";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || "";
    const type = url.searchParams.get("type") || "";
    const force = url.searchParams.get("force") === "1";
    if (!isAnalyticsConnectionType(type)) {
      return NextResponse.json({ error: "Invalid connection type" }, { status: 400 });
    }
    const { admin } = await requireAnalyticsAccess(workspaceId, { admin: true });
    const properties = await fetchWithServerCache<AnalyticsPropertyOption[]>(
      analyticsPropertiesCacheKey(workspaceId, type),
      async () => {
        const { token } = await getValidAnalyticsAccessToken(admin, workspaceId, type);
        return type === "search-console"
          ? listSearchConsoleSites(token)
          : listAnalyticsProperties(token);
      },
      undefined,
      force
    );
    return NextResponse.json({ properties });
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspaceId || "");
    const type = String(body.type || "");
    const selectedProperty = String(body.selectedProperty || "").trim();
    const propertyDetails =
      body.propertyDetails && typeof body.propertyDetails === "object"
        ? (body.propertyDetails as Record<string, unknown>)
        : {};
    if (!isAnalyticsConnectionType(type) || !selectedProperty) {
      throw new AnalyticsHttpError(400, "Missing type or selectedProperty");
    }
    const { admin } = await requireAnalyticsAccess(workspaceId, { admin: true });
    await updateSelectedProperty(admin, workspaceId, type, selectedProperty, propertyDetails);
    invalidateServerAnalyticsCache(workspaceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}
