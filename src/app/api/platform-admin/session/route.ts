import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/simple-rate-limit";
import {
  clearPlatformAdminSession,
  hasPlatformAdminSession,
  passwordsMatch,
  writePlatformAdminSession,
} from "@/lib/platform-admin/server-auth";

export async function GET() {
  const ok = await hasPlatformAdminSession();
  return NextResponse.json({ ok });
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`admin-login:${clientIp(req)}`, 5, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "");
  const password = String(body.password || "");
  if (!passwordsMatch(email, password)) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  await writePlatformAdminSession();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearPlatformAdminSession();
  return NextResponse.json({ ok: true });
}
