import { NextRequest, NextResponse } from "next/server";
import { searchLiveDirectory } from "@/lib/platform-admin/live";
import { requirePlatformAdmin } from "@/lib/platform-admin/server-auth";

export async function GET(req: NextRequest) {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("q") || "";
  try {
    const results = await searchLiveDirectory(q);
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 }
    );
  }
}
