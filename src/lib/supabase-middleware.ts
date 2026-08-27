import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminInternalPath, isAdminPublicPath } from "@/lib/platform-admin/paths";

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

  // Use getSession() instead of getUser() — reads from cookies locally,
  // no network round-trip to Supabase auth servers (~400-800ms saved per navigation)
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // If not logged in, redirect to login
  if (!session?.user) {
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
