import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeStoreAgent, callStoreAgentService } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ approvalId: string }> };

const bodySchema = z.object({ workspaceId: z.string().uuid() });

/** Put back the values an approved store change overwrote. */
export async function POST(request: NextRequest, { params }: Params) {
  const { approvalId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const access = await authorizeStoreAgent({ workspaceId: parsed.data.workspaceId });
  if (access instanceof NextResponse) return access;

  const { data: approval } = await access.admin
    .from("store_agent_approvals")
    .select("id, workspace_id, kind")
    .eq("id", approvalId)
    .eq("workspace_id", parsed.data.workspaceId)
    .maybeSingle();
  if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (approval.kind !== "write" && !["owner", "admin"].includes(String(access.ctx.membershipRole))) {
    return NextResponse.json({ error: "Only the workspace owner or an admin can undo bulk changes." }, { status: 403 });
  }

  try {
    const res = await callStoreAgentService({ path: "/store-agent/approvals/undo", userId: access.userId, body: { approvalId } });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json({ error: "The agent service is not available right now." }, { status: 503 });
  }
}
