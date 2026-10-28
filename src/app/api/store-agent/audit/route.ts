import { NextRequest, NextResponse } from "next/server";
import { authorizeStoreAgent } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every change the agent made to the store in this workspace, newest first. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  const before = request.nextUrl.searchParams.get("before");

  let query = access.admin
    .from("store_agent_audit_log")
    .select("id, operation, scope, affected_ids, ok, error, created_at, chat_id, approval_id, user_id, store_agent_chats(title)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load the history" }, { status: 500 });

  const userIds = [...new Set((data ?? []).map((r) => r.user_id).filter(Boolean))] as string[];
  const { data: profiles } = userIds.length
    ? await access.admin.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] as Array<{ id: string; full_name: string | null }> };
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string | null) || ""]));

  return NextResponse.json({
    entries: (data ?? []).map((r) => ({
      id: r.id,
      operation: r.operation,
      records: (r.affected_ids as string[] | null)?.length ?? 0,
      ok: r.ok,
      error: r.error,
      createdAt: r.created_at,
      chatId: r.chat_id,
      chatTitle: (r.store_agent_chats as { title?: string } | null)?.title ?? null,
      by: r.user_id ? (names.get(r.user_id as string) ?? null) : null,
    })),
  });
}
