import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { isAssistantEnabled } from "@/lib/assistant/service-client";
import {
  AGENT_ACCESS_COOKIE,
  AGENT_ACCESS_MAX_AGE,
  accessToken,
  checkAccessCode,
  hasAgentAccess,
} from "@/lib/assistant/access-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unlockSchema = z.object({ code: z.string().min(1).max(200) });

async function signedInUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

/** Whether the agent is unlocked in this browser for the signed-in user. */
export async function GET() {
  if (!isAssistantEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await signedInUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ unlocked: await hasAgentAccess(userId) });
}

export async function POST(request: Request) {
  if (!isAssistantEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await signedInUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = unlockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const check = checkAccessCode(userId, parsed.data.code);
  if (!check.ok) {
    const status = check.reason === "too_many" ? 429 : check.reason === "not_configured" ? 503 : 403;
    return NextResponse.json({ error: check.reason }, { status });
  }

  const response = NextResponse.json({ unlocked: true });
  response.cookies.set(AGENT_ACCESS_COOKIE, accessToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: AGENT_ACCESS_MAX_AGE,
  });
  return response;
}

/** Lock the agent again in this browser. */
export async function DELETE() {
  const response = NextResponse.json({ unlocked: false });
  response.cookies.set(AGENT_ACCESS_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
