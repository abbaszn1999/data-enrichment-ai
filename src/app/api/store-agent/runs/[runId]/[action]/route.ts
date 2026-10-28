import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { questionAnswersSchema } from "@/lib/store-agent/protocol";
import { authorizeStoreAgent, callStoreAgentService, relayEvents } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ runId: string; action: string }> };

const UUID = /^[0-9a-f-]{36}$/i;

/** Reconnect to a live run: replays events after `after`, then follows it. */
export async function GET(request: NextRequest, { params }: Params) {
  const { runId, action } = await params;
  if (action !== "stream" || !UUID.test(runId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  const after = Math.max(0, Number(request.nextUrl.searchParams.get("after")) || 0);
  let upstream: Response;
  try {
    upstream = await callStoreAgentService({
      path: `/store-agent/runs/${runId}/stream`,
      userId: access.userId,
      method: "GET",
      query: `after=${after}`,
    });
  } catch {
    return NextResponse.json({ error: "The agent is not available right now." }, { status: 503 });
  }
  if (upstream.status === 404) return NextResponse.json({ error: "Run finished" }, { status: 404 });
  if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "The agent is not available right now." }, { status: 503 });
  return relayEvents(upstream, request);
}

const bodies = {
  cancel: z.object({ workspaceId: z.string().uuid() }),
  steer: z.object({ workspaceId: z.string().uuid(), text: z.string().trim().min(1).max(4000) }),
  approve: z.object({ workspaceId: z.string().uuid(), approvalId: z.string().uuid(), approve: z.boolean() }),
  answer: z.object({ workspaceId: z.string().uuid(), questionId: z.string().min(1).max(80), answers: questionAnswersSchema }),
} as const;

/** Stop, steer, approve a store change, or answer a question, on a live run. */
export async function POST(request: NextRequest, { params }: Params) {
  const { runId, action } = await params;
  if (!UUID.test(runId) || !(action in bodies)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = bodies[action as keyof typeof bodies].safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const data = parsed.data as Record<string, unknown> & { workspaceId: string };
  const access = await authorizeStoreAgent({ workspaceId: data.workspaceId });
  if (access instanceof NextResponse) return access;

  // Deletes and bulk changes need the workspace owner or an admin.
  if (action === "approve" && data.approve === true) {
    const { data: approval } = await access.admin
      .from("store_agent_approvals")
      .select("kind")
      .eq("id", String(data.approvalId))
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (approval.kind !== "write" && !["owner", "admin"].includes(String(access.ctx.membershipRole))) {
      return NextResponse.json({ error: "Only the workspace owner or an admin can approve deletes and bulk changes." }, { status: 403 });
    }
  }

  const forward: Record<string, { path: string; body: unknown }> = {
    cancel: { path: "/store-agent/runs/cancel", body: { runId } },
    steer: { path: "/store-agent/runs/steer", body: { runId, text: data.text } },
    approve: { path: "/store-agent/approvals", body: { runId, approvalId: data.approvalId, approve: data.approve } },
    answer: { path: "/store-agent/questions", body: { runId, questionId: data.questionId, answers: data.answers } },
  };
  const target = forward[action]!;
  try {
    const res = await callStoreAgentService({ path: target.path, userId: access.userId, body: target.body });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.ok ? 200 : res.status === 404 ? 404 : 502 });
  } catch {
    return NextResponse.json({ error: "The agent is not available right now." }, { status: 503 });
  }
}
