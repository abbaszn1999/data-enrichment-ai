import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  let response = NextResponse.json({ success: false }, { status: 500 });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          response = NextResponse.json({ success: true });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
      auth: {
        flowType: "pkce",
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.json(
      { error: error?.message || "Failed to exchange code for session" },
      { status: 400 }
    );
  }

  const body = {
    success: true,
    user: {
      created_at: data.user.created_at,
      last_sign_in_at: data.user.last_sign_in_at,
      user_metadata: data.user.user_metadata,
    },
  };

  if (response.status === 500) {
    response = NextResponse.json(body);
  } else {
    response = NextResponse.json(body, { status: 200, headers: response.headers });
    response.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
  }

  return response;
}
