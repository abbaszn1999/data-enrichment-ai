import { createHmac, timingSafeEqual } from "crypto";
import type { AnalyticsConnectionType } from "./types";
import { isAnalyticsConnectionType } from "./types";

const STATE_TTL_MS = 15 * 60 * 1000;
const SCOPES: Record<AnalyticsConnectionType, string[]> = {
  "search-console": [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/webmasters.readonly",
  ],
  "google-analytics": [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/analytics.readonly",
  ],
};

export type AnalyticsOAuthState = {
  workspaceId: string;
  slug: string;
  type: AnalyticsConnectionType;
  userId: string;
  exp: number;
};

export function googleAnalyticsOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_ANALYTICS_CLIENT_ID &&
      process.env.GOOGLE_ANALYTICS_CLIENT_SECRET
  );
}

function oauthSecret(): string {
  const secret =
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.GOOGLE_ANALYTICS_CLIENT_SECRET;
  if (!secret) {
    throw new Error("Google Analytics OAuth is not configured");
  }
  return secret;
}

function signPayload(encoded: string): string {
  return createHmac("sha256", oauthSecret()).update(encoded).digest("base64url");
}

export function createAnalyticsOAuthState(input: Omit<AnalyticsOAuthState, "exp">): string {
  const payload: AnalyticsOAuthState = {
    ...input,
    exp: Date.now() + STATE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signPayload(encoded)}`;
}

export function verifyAnalyticsOAuthState(raw: string): AnalyticsOAuthState | null {
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const encoded = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let expected: string;
  try {
    expected = signPayload(encoded);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AnalyticsOAuthState;
    if (!parsed.workspaceId || !parsed.slug || !parsed.userId || !isAnalyticsConnectionType(parsed.type)) {
      return null;
    }
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function analyticsOAuthRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/analytics/oauth/callback`;
}

export function getAnalyticsAuthUrl(origin: string, state: string, type: AnalyticsConnectionType): string {
  const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_ANALYTICS_CLIENT_ID is not set");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: analyticsOAuthRedirectUri(origin),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: SCOPES[type].join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string;
  email: string | null;
};

export async function exchangeAnalyticsCode(origin: string, code: string): Promise<GoogleTokenSet> {
  const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google Analytics OAuth is not configured");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: analyticsOAuthRedirectUri(origin),
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Failed to exchange Google auth code");
  }

  const email = await fetchGoogleEmail(json.access_token);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000),
    scopes: json.scope ?? SCOPES["search-console"].join(" "),
    email,
  };
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenSet> {
  const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google Analytics OAuth is not configured");
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Failed to refresh Google access token");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000),
    scopes: json.scope ?? "",
    email: null,
  };
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}
