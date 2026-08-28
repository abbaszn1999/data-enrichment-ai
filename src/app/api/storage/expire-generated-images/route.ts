import { NextRequest, NextResponse } from "next/server";
import { expireGeneratedImages } from "@/lib/storage/expire-generated-images";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 120;

function authorized(request: NextRequest): boolean {
  const secret =
    process.env.JOBS_CRON_SECRET?.trim() ||
    process.env.GROWTH_SYNC_CRON_SECRET?.trim();
  if (!secret) return false;
  const presented = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  return presented === secret;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    const secret =
      process.env.JOBS_CRON_SECRET?.trim() ||
      process.env.GROWTH_SYNC_CRON_SECRET?.trim();
    if (!secret) {
      return NextResponse.json({ error: "Scheduler not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await expireGeneratedImages(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[expire-generated-images]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Expire failed" },
      { status: 500 }
    );
  }
}
