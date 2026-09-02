import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext } from "@/lib/workspace-context";
import {
  clearStoreAssistantCheckpoint,
  loadStoreAssistantCheckpoint,
} from "@/lib/sync/agent/checkpoint";

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const checkpoint = await loadStoreAssistantCheckpoint(createAdminClient(), workspaceId);
  if (!checkpoint) return NextResponse.json({ checkpoint: null });
  return NextResponse.json({
    checkpoint: {
      processed: checkpoint.processed,
      total: checkpoint.total,
      column: checkpoint.column,
      updatedAt: checkpoint.updatedAt,
      rowCount: checkpoint.sheet.rows.length,
    },
  });
}

export async function DELETE(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await clearStoreAssistantCheckpoint(createAdminClient(), workspaceId);
  return NextResponse.json({ ok: true });
}
