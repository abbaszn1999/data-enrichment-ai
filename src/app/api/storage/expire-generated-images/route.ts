import { NextRequest, NextResponse } from "next/server";
import { expireGeneratedImages } from "@/lib/storage/expire-generated-images";
import { createAdminClient } from "@/lib/supabase-admin";

import { cronSecretFromEnv, cronSecretMatches } from "@/lib/auth/cron-secret";

export const maxDuration = 120;

function authorized(request: NextRequest): boolean {
  const secret = cronSecretFromEnv();
  if (!secret) return false;
  return cronSecretMatches(request, secret);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    if (!cronSecretFromEnv()) {
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
