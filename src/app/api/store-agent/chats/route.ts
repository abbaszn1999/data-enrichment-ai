import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { modelParamSchema } from "@/lib/store-agent/protocol";
import { authorizeStoreAgent } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_COLUMNS =
  "id, title, model_id, model_params, mode, status, context_used, context_window, credits_total, pinned, created_at, last_activity_at";

/** The user's chats in a workspace, pinned first, then most recent. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  const search = request.nextUrl.searchParams.get("q")?.trim().slice(0, 100);

  let query = access.admin
    .from("store_agent_chats")
    .select(CHAT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("user_id", access.userId)
    .order("pinned", { ascending: false })
    .order("last_activity_at", { ascending: false })
    .limit(200);
  if (search) query = query.ilike("title", `%${search.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load chats" }, { status: 500 });
  return NextResponse.json({ chats: data ?? [] });
}

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  modelId: z.string().min(1).max(80).optional(),
  modelParams: z.array(modelParamSchema).max(10).optional(),
  mode: z.enum(["agent", "plan"]).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const access = await authorizeStoreAgent({ workspaceId: parsed.data.workspaceId });
  if (access instanceof NextResponse) return access;

  // New chats start from the user's last choice, else the platform default.
  const [{ data: prefs }, { data: models }] = await Promise.all([
    access.admin
      .from("store_agent_prefs")
      .select("model_id, model_params")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", access.userId)
      .maybeSingle(),
    access.admin.from("store_agent_models").select("model_id, default_params, is_default").eq("enabled", true),
  ]);
  const enabled = new Map((models ?? []).map((m) => [m.model_id as string, m]));
  const fallback = (models ?? []).find((m) => m.is_default) ?? models?.[0];
  const requested = parsed.data.modelId && enabled.has(parsed.data.modelId) ? parsed.data.modelId : null;
  const remembered = prefs?.model_id && enabled.has(prefs.model_id) ? (prefs.model_id as string) : null;
  const modelId = requested ?? remembered ?? (fallback?.model_id as string | undefined) ?? "composer-2.5";
  const modelParams =
    requested && parsed.data.modelParams
      ? parsed.data.modelParams
      : !requested && remembered && prefs?.model_params
        ? prefs.model_params
        : (enabled.get(modelId)?.default_params ?? []);

  const { data, error } = await access.admin
    .from("store_agent_chats")
    .insert({
      workspace_id: parsed.data.workspaceId,
      user_id: access.userId,
      model_id: modelId,
      model_params: modelParams,
      mode: parsed.data.mode ?? "agent",
    })
    .select(CHAT_COLUMNS)
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not create the chat" }, { status: 500 });
  return NextResponse.json({ chat: data });
}
