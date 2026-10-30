import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { PREVIEW_COOKIE, PREVIEW_COOKIE_MAX_AGE, isPreviewPassword, previewToken } from "@/lib/google-ads/preview-access";

const MAX_TRIES = 5;
const WINDOW_MS = 10 * 60 * 1000;
/** Wrong passwords per user, so the password cannot be guessed by trying. */
const tries = new Map<string, { count: number; until: number }>();

/** Unlock the Google Ads prototype for this browser. Signed-in users only. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const now = Date.now();
  const entry = tries.get(user.id);
  if (entry && entry.until > now && entry.count >= MAX_TRIES) {
    return NextResponse.json({ error: "Too many tries. Wait a few minutes and try again." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > 200 || !isPreviewPassword(password)) {
    const current = entry && entry.until > now ? entry : { count: 0, until: now + WINDOW_MS };
    tries.set(user.id, { count: current.count + 1, until: current.until });
    return NextResponse.json({ error: "Wrong password." }, { status: 403 });
  }

  const token = previewToken();
  if (!token) return NextResponse.json({ error: "Not available" }, { status: 503 });
  tries.delete(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PREVIEW_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_COOKIE_MAX_AGE,
  });
  return res;
}
