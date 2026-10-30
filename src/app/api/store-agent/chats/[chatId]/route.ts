import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { modelParamSchema } from "@/lib/store-agent/protocol";
import { requestLabel } from "@/lib/store-agent/mentions";
import { authorizeStoreAgent, callStoreAgentService, loadOwnedChat } from "@/lib/store-agent/server";
import { decodeStoragePath } from "@/lib/store-agent/storage-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ chatId: string }> };

/** A chat with its messages, files and the live run (if any) to reconnect to. */
export async function GET(request: NextRequest, { params }: Params) {
  const { chatId } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  const chat = await loadOwnedChat(access, workspaceId, chatId);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Newest messages first in pages of PAGE; `before` loads the page above.
  const PAGE = 100;
  const before = request.nextUrl.searchParams.get("before");
  let messageQuery = access.admin
    .from("store_agent_messages")
    .select("id, run_id, role, content, blocks, attachments, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(PAGE + 1);
  if (before) messageQuery = messageQuery.lt("created_at", before);

  const [messages, files, live, approvals, plans] = await Promise.all([
    messageQuery,
    access.admin
      .from("store_agent_files")
      .select("id, name, kind, mime, size, created_by, created_at, storage_path, shown, run_id")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true }),
    callStoreAgentService({ path: `/store-agent/chats/${chatId}/live`, userId: access.userId, method: "GET" })
      .then((r) => (r.ok ? r.json() : { run: null }))
      .catch(() => ({ run: null })),
    access.admin
      .from("store_agent_approvals")
      .select("id, status, undoable, applied_at, undone_at, kind")
      .eq("chat_id", chatId),
    access.admin
      .from("store_agent_plans")
      .select("id, title, content, version, status, build_run_id, updated_at")
      .eq("chat_id", chatId)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  const page = messages.data ?? [];
  const hasMore = page.length > PAGE;
  const ordered = page.slice(0, PAGE).reverse();

  const { data: runs } = await access.admin
    .from("store_agent_runs")
    .select("id, credits, status, input_tokens, output_tokens, cache_read_tokens, started_at, finished_at")
    .eq("chat_id", chatId);
  const runById = new Map((runs ?? []).map((r) => [r.id as string, r]));

  // The request each file came from, shown under its name in the panel.
  const fileRuns = [...new Set((files.data ?? []).flatMap((f) => (f.run_id ? [String(f.run_id)] : [])))];
  const { data: asks } = fileRuns.length
    ? await access.admin.from("store_agent_messages").select("run_id, content").eq("chat_id", chatId).eq("role", "user").in("run_id", fileRuns)
    : { data: [] as Array<{ run_id: string; content: string }> };
  const requestByRun = new Map((asks ?? []).map((m) => [String(m.run_id), requestLabel(String(m.content ?? ""))]));

  return NextResponse.json({
    chat,
    hasMore,
    approvals: Object.fromEntries(
      (approvals.data ?? []).map((a) => [
        a.id,
        { status: a.status, kind: a.kind, undoable: !!a.undoable && !!a.applied_at && !a.undone_at, undone: !!a.undone_at, applied: !!a.applied_at },
      ])
    ),
    messages: ordered.map((m) => ({ ...m, run: m.run_id ? (runById.get(m.run_id) ?? null) : null })),
    files: (files.data ?? []).map((f) => ({
      ...f,
      // Path within the chat folder, for display.
      path: decodeStoragePath(String(f.storage_path).split("/").slice(2).join("/")),
      storage_path: undefined,
      request: f.run_id ? (requestByRun.get(String(f.run_id)) ?? null) : null,
    })),
    plans: plans.data ?? [],
    live: (live as { run: unknown }).run ?? null,
  });
}

const patchSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  modelId: z.string().min(1).max(80).optional(),
  modelParams: z.array(modelParamSchema).max(10).optional(),
  mode: z.enum(["agent", "plan"]).optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const { chatId } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const access = await authorizeStoreAgent({ workspaceId: parsed.data.workspaceId });
  if (access instanceof NextResponse) return access;
  const chat = await loadOwnedChat(access, parsed.data.workspaceId, chatId);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.pinned !== undefined) update.pinned = parsed.data.pinned;
  if (parsed.data.mode !== undefined) update.mode = parsed.data.mode;
  if (parsed.data.modelId !== undefined) {
    const { data: model } = await access.admin
      .from("store_agent_models")
      .select("model_id")
      .eq("model_id", parsed.data.modelId)
      .eq("enabled", true)
      .maybeSingle();
    if (!model) return NextResponse.json({ error: "Unknown model" }, { status: 400 });
    update.model_id = parsed.data.modelId;
    update.model_params = parsed.data.modelParams ?? [];
    // Remember the choice for the next new chat.
    await access.admin.from("store_agent_prefs").upsert(
      {
        workspace_id: parsed.data.workspaceId,
        user_id: access.userId,
        model_id: parsed.data.modelId,
        model_params: parsed.data.modelParams ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" }
    );
  }
  const { data, error } = await access.admin.from("store_agent_chats").update(update).eq("id", chatId).select("*").single();
  if (error) return NextResponse.json({ error: "Could not update the chat" }, { status: 500 });
  return NextResponse.json({ chat: data });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { chatId } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  const chat = await loadOwnedChat(access, workspaceId, chatId);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const res = await callStoreAgentService({ path: "/store-agent/chats/delete", userId: access.userId, body: { chatId } });
    if (!res.ok) return NextResponse.json({ error: "Could not delete the chat" }, { status: 502 });
  } catch {
    return NextResponse.json({ error: "The agent service is not available." }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
