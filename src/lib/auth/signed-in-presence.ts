import type { NextResponse } from "next/server";

/** Marketing-site header flag only. Never store tokens, user ids, or JWTs. */
export const SIGNED_IN_PRESENCE_COOKIE = "autommerce_signed_in";

/** Refreshed while the user is active; logout always expires it immediately. */
export const SIGNED_IN_PRESENCE_MAX_AGE = 60 * 60 * 24 * 30;

export function signedInPresenceDomain(hostname: string): string | undefined {
  const host = hostname.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase() ?? "";
  if (host === "autommerce.com" || host.endsWith(".autommerce.com")) {
    return ".autommerce.com";
  }
  return undefined;
}

export function signedInPresenceCookieOptions(params: {
  hostname: string;
  secure: boolean;
  signedIn: boolean;
}) {
  const domain = signedInPresenceDomain(params.hostname);
  return {
    path: "/",
    secure: params.secure,
    sameSite: "lax" as const,
    httpOnly: false,
    maxAge: params.signedIn ? SIGNED_IN_PRESENCE_MAX_AGE : 0,
    ...(domain ? { domain } : {}),
  };
}

export function applySignedInPresenceCookie(
  response: NextResponse,
  params: { hostname: string; secure: boolean; signedIn: boolean }
): NextResponse {
  response.cookies.set(
    SIGNED_IN_PRESENCE_COOKIE,
    params.signedIn ? "1" : "",
    signedInPresenceCookieOptions(params)
  );
  return response;
}

function browserPresenceCookieParts(maxAge: number, value: string): string {
  const parts = [
    `${SIGNED_IN_PRESENCE_COOKIE}=${value}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  const domain = signedInPresenceDomain(window.location.hostname);
  if (domain) parts.push(`Domain=${domain}`);
  if (window.location.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

export function writeSignedInPresenceCookieBrowser(): void {
  document.cookie = browserPresenceCookieParts(SIGNED_IN_PRESENCE_MAX_AGE, "1");
}

export function clearSignedInPresenceCookieBrowser(): void {
  document.cookie = browserPresenceCookieParts(0, "");
}
