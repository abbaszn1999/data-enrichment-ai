import { NextResponse } from "next/server";
import { loadLiveWorkspaces } from "@/lib/platform-admin/live";
import { requirePlatformAdmin } from "@/lib/platform-admin/server-auth";

export async function GET() {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  try {
    const workspaces = await loadLiveWorkspaces();
    return NextResponse.json({ workspaces });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load workspaces" },
      { status: 500 }
    );
  }
}
