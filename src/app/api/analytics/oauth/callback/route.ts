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
import {
  analyticsPropertiesCacheKey,
  fetchWithServerCache,
  invalidateServerAnalyticsCache,
} from "@/lib/analytics/cache";

export const maxDuration = 60;

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

    const accessToken = tokens.accessToken;
    // These two are independent — the property listing only needs the fresh
    // access token, not the row we just wrote — so run them in parallel
    // instead of serially to cut connect latency.
    const [saved, properties] = await Promise.all([
      getAnalyticsConnection(admin, state.workspaceId, state.type),
      state.type === "search-console"
        ? listSearchConsoleSites(accessToken).catch(() => [])
        : listAnalyticsProperties(accessToken).catch(() => []),
    ]);

    if (!saved?.selected_property && properties.length === 1) {
      await updateSelectedProperty(
        admin,
        state.workspaceId,
        state.type,
        properties[0].id,
        { label: properties[0].label, detail: properties[0].detail }
      );
    }

    // The status route caches connection state for 60s. Without this, the
    // page the user is about to land on can read a stale "not connected"
    // snapshot (possibly from a different serverless instance) and never
    // show the property picker until that cache naturally expires.
    invalidateServerAnalyticsCache(state.workspaceId);

    // We already paid for this exact property listing above — seed the
    // properties route's cache with it so the picker popup that's about to
    // open on the landing page reads it instantly instead of re-querying
    // Google for the same data a few hundred milliseconds later.
    await fetchWithServerCache(
      analyticsPropertiesCacheKey(state.workspaceId, state.type),
      async () => properties
    );

    await writeSecurityAuditLog(admin, {
      workspaceId: state.workspaceId,
      actorId: user.id,
      action: "analytics.connect",
      after: { type: state.type, email: tokens.email },
      request,
    });

    const alreadyHasProperty = Boolean(saved?.selected_property) || properties.length === 1;
    return redirectToAnalytics(origin, state.slug, {
      connected: state.type,
      pick: !alreadyHasProperty && properties.length > 1 ? "1" : "0",
    });
  } catch (err) {
    console.error("[analytics oauth callback]", err);
    return fail("callback_failed");
  }
}
