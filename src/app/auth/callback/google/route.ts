import { NextResponse } from "next/server";
import { publicOriginFromRequest } from "@/lib/app-origin";
import { createClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = publicOriginFromRequest(request);
  const code = searchParams.get("code");

  let next = searchParams.get("next") ?? "/workspaces";
  if (!next.startsWith("/") || next.startsWith("//")) {
    next = "/workspaces";
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth/callback/google] exchange failed:", error.message);
  } else {
    const providerError =
      searchParams.get("error_description") || searchParams.get("error");
    if (providerError) {
      console.error("[auth/callback/google] provider error:", providerError);
    }
  }

  const params = new URLSearchParams({ error: "auth_callback_error" });
  const errorCode = searchParams.get("error_code") || searchParams.get("error");
  if (errorCode) params.set("error_code", errorCode);
  if (next !== "/workspaces") params.set("redirect", next);
  return NextResponse.redirect(`${origin}/login?${params.toString()}`);
}
