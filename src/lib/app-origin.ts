export const CANONICAL_APP_ORIGIN = "https://platform.autommerce.com";

export function getAppOrigin(): string {
  const fromEnv = (
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/+$/, "");
  return fromEnv || CANONICAL_APP_ORIGIN;
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase() ?? "";
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Public origin for auth redirects. Render binds to localhost:10000, so
 * `new URL(request.url).origin` is wrong in production and sends Google
 * sign-in back to the user's machine.
 */
export function publicOriginFromRequest(request: Request): string {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "development") {
    return url.origin;
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const headerHost = request.headers.get("host")?.split(",")[0]?.trim() ?? "";
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "http" ? "http" : "https";

  if (forwardedHost && !isLoopbackHost(forwardedHost)) {
    return `${proto}://${forwardedHost}`;
  }
  if (headerHost && !isLoopbackHost(headerHost)) {
    return `${proto}://${headerHost}`;
  }
  if (!isLoopbackHost(url.host)) {
    return url.origin.startsWith("http://") && proto === "https"
      ? `https://${url.host}`
      : url.origin;
  }
  return getAppOrigin();
}

export function snippetOrigin(currentOrigin?: string): string {
  const current = (currentOrigin || "").replace(/\/+$/, "");
  if (
    !current ||
    current.includes("localhost") ||
    current.includes("127.0.0.1")
  ) {
    return getAppOrigin();
  }
  return current;
}
