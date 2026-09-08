import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminInternalPath, isAdminPublicPath } from "@/lib/platform-admin/paths";
import { jwtSecretFromEnv, verifySupabaseAccessToken } from "@/lib/auth/verify-jwt";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { pathname } = request.nextUrl;

  // Public routes that don't need auth — skip everything early
  const publicRoutes = [
    "/login",
    "/register",
    "/reset-password",
    "/auth/callback",
    "/invite",
    "/widget.js",
  ];
  const isPublicRoute =
    publicRoutes.some((r) => pathname.startsWith(r)) ||
    pathname === "/widget.js" ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css");
  const isDemoRoute = pathname.startsWith("/demo");
  const isAdminRoute = isAdminPublicPath(pathname) || isAdminInternalPath(pathname);
  const isApiRoute = pathname.startsWith("/api");

  if (isPublicRoute || isDemoRoute || isAdminRoute || isApiRoute) {
    return supabaseResponse;
  }

  // Check session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const secret = jwtSecretFromEnv();
  let isAuthenticated = false;

  if (session?.access_token && secret) {
    const verified = verifySupabaseAccessToken(session.access_token, secret);
    if (verified) {
      isAuthenticated = true;
    }
  }

  // Fallback to auth server check if secret is not configured or token expired/unverified
  if (!isAuthenticated) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      isAuthenticated = true;
    }
  }

  if (!isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // If logged in and on root, redirect to workspaces
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/workspaces";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
