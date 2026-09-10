import { NextRequest, NextResponse } from "next/server";
import { publicOriginFromRequest } from "@/lib/app-origin";
import { requireAnalyticsAccess, AnalyticsHttpError } from "@/lib/analytics/access";
import {
  createAnalyticsOAuthState,
  getAnalyticsAuthUrl,
  googleAnalyticsOAuthConfigured,
} from "@/lib/analytics/oauth";
import { isAnalyticsConnectionType } from "@/lib/analytics/types";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") || "";
  const type = url.searchParams.get("type") || "";
  const origin = publicOriginFromRequest(request);

  const fallback = (slug: string, error: string) =>
    NextResponse.redirect(new URL(`/w/${slug}/analytics/overview?error=${encodeURIComponent(error)}`, origin));

  try {
    if (!googleAnalyticsOAuthConfigured()) {
      throw new AnalyticsHttpError(503, "not_configured");
    }
    if (!isAnalyticsConnectionType(type)) {
      throw new AnalyticsHttpError(400, "invalid_type");
    }
    const { user, admin } = await requireAnalyticsAccess(workspaceId, { admin: true });
    const { data: workspace } = await admin
      .from("workspaces")
      .select("slug")
      .eq("id", workspaceId)
      .maybeSingle();
    if (!workspace?.slug) {
      throw new AnalyticsHttpError(404, "workspace_not_found");
    }
    const state = createAnalyticsOAuthState({
      workspaceId,
      slug: workspace.slug,
      type,
      userId: user.id,
    });
    return NextResponse.redirect(getAnalyticsAuthUrl(origin, state, type));
  } catch (err) {
    const slug = url.searchParams.get("slug") || "";
    const code =
      err instanceof AnalyticsHttpError
        ? err.status === 401
          ? "unauthorized"
          : err.status === 403
            ? "forbidden"
            : err.message
        : "oauth_start_failed";
    if (slug) return fallback(slug, code);
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
