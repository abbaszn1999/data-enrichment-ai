import { NextRequest, NextResponse } from "next/server";
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
