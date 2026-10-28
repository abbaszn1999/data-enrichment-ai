import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { STORE_AGENT_LIMITS, modelParamSchema, type StartRunRequest } from "@/lib/store-agent/protocol";
import { authorizeStoreAgent, callStoreAgentService, loadOwnedChat, relayEvents } from "@/lib/store-agent/server";
import { rateLimit } from "@/lib/simple-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sendSchema = z.object({
  workspaceId: z.string().uuid(),
  message: z.string().max(STORE_AGENT_LIMITS.maxMessageChars),
  attachmentIds: z.array(z.string().uuid()).max(STORE_AGENT_LIMITS.maxAttachments).default([]),
  model: z.object({ id: z.string().min(1).max(80), params: z.array(modelParamSchema).max(10) }).optional(),
  mode: z.enum(["agent", "plan"]).optional(),
  /** Build this plan of the chat (the Build button). */
  buildPlanId: z.string().uuid().optional(),
});

type Params = { params: Promise<{ chatId: string }> };

/** Start a run and stream it. Leaving the page does not stop it; reconnect with /runs/{id}/stream. */
export async function POST(request: NextRequest, { params }: Params) {
  const { chatId } = await params;
  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;
  if (!body.message.trim() && body.attachmentIds.length === 0) {
    return NextResponse.json({ error: "Write a message" }, { status: 400 });
  }

  const access = await authorizeStoreAgent({ workspaceId: body.workspaceId, requireCredits: true });
  if (access instanceof NextResponse) return access;
  const limit = rateLimit(`store-agent:${access.userId}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const chat = await loadOwnedChat(access, body.workspaceId, chatId);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The model must be one the platform has enabled.
  const modelId = body.model?.id ?? (chat.model_id as string);
  const { data: model } = await access.admin
    .from("store_agent_models")
    .select("model_id")
    .eq("model_id", modelId)
    .eq("enabled", true)
    .maybeSingle();
  if (!model) return NextResponse.json({ error: "This model is not available." }, { status: 400 });

  const [{ data: files }, { data: prefs }] = await Promise.all([
    body.attachmentIds.length
      ? access.admin
          .from("store_agent_files")
          .select("id, name, mime, size, storage_path")
          .eq("chat_id", chatId)
          .eq("created_by", "user")
          .in("id", body.attachmentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; mime: string; size: number; storage_path: string }> }),
    access.admin
      .from("store_agent_prefs")
      .select("auto_run")
      .eq("workspace_id", body.workspaceId)
      .eq("user_id", access.userId)
      .maybeSingle(),
  ]);
  if ((files ?? []).length !== body.attachmentIds.length) return NextResponse.json({ error: "Attachment not found" }, { status: 400 });

  // Build runs in Agent mode, on a plan of this chat that is not already building.
  if (body.buildPlanId) {
    const { data: plan } = await access.admin
      .from("store_agent_plans")
      .select("id, status")
      .eq("id", body.buildPlanId)
      .eq("chat_id", chatId)
      .maybeSingle();
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (plan.status === "building") return NextResponse.json({ error: "This plan is already being built." }, { status: 409 });
  }

  const payload: StartRunRequest = {
    runId: randomUUID(),
    chatId,
    workspaceId: body.workspaceId,
    userId: access.userId,
    message: body.message.trim() || "(see the attached files)",
    attachments: (files ?? []).map((f) => ({
      fileId: f.id as string,
      name: f.name as string,
      mime: f.mime as string,
      size: Number(f.size),
      storagePath: f.storage_path as string,
    })),
    model: { id: modelId, params: body.model?.params ?? (chat.model_params as StartRunRequest["model"]["params"]) ?? [] },
    mode: body.buildPlanId ? "agent" : (body.mode ?? (chat.mode as "agent" | "plan")),
    ...(body.buildPlanId ? { buildPlanId: body.buildPlanId } : {}),
    autoRun: prefs?.auto_run === true,
    autoRunBulk: prefs?.auto_run === true && ["owner", "admin"].includes(String(access.ctx.membershipRole)),
    billing: {
      ownerUserId: access.ctx.subscription!.user_id as string,
      remainingCredits: Math.max(0, Number(access.ctx.credits?.total ?? 0)),
    },
  };

  let upstream: Response;
  try {
    upstream = await callStoreAgentService({ path: "/store-agent/runs", userId: access.userId, body: payload });
  } catch {
    return NextResponse.json({ error: "The agent is not available right now." }, { status: 503 });
  }
  if (upstream.status === 429) {
    const err = await upstream.json().catch(() => ({}));
    return NextResponse.json({ error: (err as { error?: string }).error ?? "The agent is busy." }, { status: 429 });
  }
  if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "The agent is not available right now." }, { status: 503 });
  const response = relayEvents(upstream, request);
  response.headers.set("X-Run-Id", payload.runId);
  return response;
}
