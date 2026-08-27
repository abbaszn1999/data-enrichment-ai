import { NextResponse } from "next/server";
import { loadLiveUsers } from "@/lib/platform-admin/live";
import { requirePlatformAdmin } from "@/lib/platform-admin/server-auth";

export async function GET() {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  try {
    const users = await loadLiveUsers();
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load users" },
      { status: 500 }
    );
  }
}
