import { NextRequest, NextResponse } from "next/server";
import { analyticsErrorResponse, requireAnalyticsAccess, AnalyticsHttpError } from "@/lib/analytics/access";
import { parseAnalyticsPageTypeParam } from "@/lib/analytics/filtered";
import { parseAnalyticsRuleConfig } from "@/lib/analytics/rules";
import { getAnalyticsRules, saveAnalyticsRules } from "@/lib/analytics/rules-store";
import { isAnalyticsPageType } from "@/lib/analytics/types";
import { fetchWithServerCache, invalidateServerAnalyticsCache } from "@/lib/analytics/cache";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") || "";
    const pageType = parseAnalyticsPageTypeParam(url.searchParams.get("pageType"));
    const force = url.searchParams.get("force") === "1";
    if (!pageType) {
      throw new AnalyticsHttpError(400, "Missing pageType");
    }
    const { admin } = await requireAnalyticsAccess(workspaceId);

    const cacheKey = `rules:${workspaceId}:${pageType}`;
    const data = await fetchWithServerCache(
      cacheKey,
      async () => {
        const rules = await getAnalyticsRules(admin, workspaceId, pageType);
        return { rules };
      },
      60 * 1000,
      force
    );

    return NextResponse.json(data);
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspaceId || "");
    const pageTypeRaw = String(body.pageType || "");
    if (!isAnalyticsPageType(pageTypeRaw)) {
      throw new AnalyticsHttpError(400, "Invalid pageType");
    }
    const parsed = parseAnalyticsRuleConfig(body);
    if (!parsed.config) {
      throw new AnalyticsHttpError(400, parsed.errors[0] || "Invalid rules");
    }
    const { admin } = await requireAnalyticsAccess(workspaceId, { admin: true });
    const rules = await saveAnalyticsRules(admin, workspaceId, pageTypeRaw, parsed.config);
    invalidateServerAnalyticsCache(workspaceId);
    return NextResponse.json({ rules });
  } catch (err) {
    return analyticsErrorResponse(err);
  }
}
