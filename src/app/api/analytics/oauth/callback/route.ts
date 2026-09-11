import { NextRequest, NextResponse } from "next/server";
import { publicOriginFromRequest } from "@/lib/app-origin";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { saveAnalyticsConnection, getAnalyticsConnection, updateSelectedProperty } from "@/lib/analytics/connections";
import {
  exchangeAnalyticsCode,
  verifyAnalyticsOAuthState,
} from "@/lib/analytics/oauth";
import { listAnalyticsProperties, listSearchConsoleSites } from "@/lib/analytics/google-api";
import { writeSecurityAuditLog } from "@/lib/security/audit-log";

function redirectToAnalytics(origin: string, slug: string, params: Record<string, string>) {
  const url = new URL(`/w/${slug}/analytics/overview`, origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const origin = publicOriginFromRequest(request);
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state") || "";
  const state = verifyAnalyticsOAuthState(stateRaw);

  if (!state) {
    return NextResponse.redirect(new URL("/workspaces?error=analytics_oauth", origin));
  }

  const fail = (codeName: string) => redirectToAnalytics(origin, state.slug, { error: codeName });

  if (error) return fail("oauth_denied");
  if (!code) return fail("missing_code");

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.id !== state.userId) return fail("unauthorized");

    const tokens = await exchangeAnalyticsCode(origin, code);
    const admin = createAdminClient();
    await saveAnalyticsConnection(admin, {
      workspaceId: state.workspaceId,
      type: state.type,
      tokens,
      keepProperty: true,
    });

    const saved = await getAnalyticsConnection(admin, state.workspaceId, state.type);
    const accessToken = tokens.accessToken;
    const properties =
      state.type === "search-console"
        ? await listSearchConsoleSites(accessToken).catch(() => [])
        : await listAnalyticsProperties(accessToken).catch(() => []);

    if (!saved?.selected_property && properties.length === 1) {
      await updateSelectedProperty(
        admin,
        state.workspaceId,
        state.type,
        properties[0].id,
        { label: properties[0].label, detail: properties[0].detail }
      );
    }

    await writeSecurityAuditLog(admin, {
      workspaceId: state.workspaceId,
      actorId: user.id,
      action: "analytics.connect",
      after: { type: state.type, email: tokens.email },
      request,
    });

    return redirectToAnalytics(origin, state.slug, {
      connected: state.type,
      pick: properties.length > 1 ? "1" : "0",
    });
  } catch (err) {
    console.error("[analytics oauth callback]", err);
    return fail("callback_failed");
  }
}
