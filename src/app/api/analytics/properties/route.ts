import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess, AnalyticsHttpError } from "@/lib/analytics/access";
import {
  getValidAnalyticsAccessToken,
  updateSelectedProperty,
} from "@/lib/analytics/connections";
import { listAnalyticsProperties, listSearchConsoleSites } from "@/lib/analytics/google-api";
import { isAnalyticsConnectionType } from "@/lib/analytics/types";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || "";
    const type = url.searchParams.get("type") || "";
    if (!isAnalyticsConnectionType(type)) {
      return NextResponse.json({ error: "Invalid connection type" }, { status: 400 });
    }
    const { admin } = await requireAnalyticsAccess(workspaceId, { admin: true });
    const { token } = await getValidAnalyticsAccessToken(admin, workspaceId, type);
    const properties =
      type === "search-console"
        ? await listSearchConsoleSites(token)
        : await listAnalyticsProperties(token);
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
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save property";
    if (message.includes("already selected")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return analyticsErrorResponse(err);
  }
}
