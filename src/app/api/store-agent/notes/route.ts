import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeStoreAgent } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Store notes: what the agent always follows in this workspace. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  const { data } = await access.admin.from("store_agent_notes").select("content, updated_at").eq("workspace_id", workspaceId).maybeSingle();
  return NextResponse.json({ content: data?.content ?? "", updatedAt: data?.updated_at ?? null });
}

const putSchema = z.object({ workspaceId: z.string().uuid(), content: z.string().max(8000) });

export async function PUT(request: NextRequest) {
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Notes are limited to 8,000 characters." }, { status: 400 });
  const access = await authorizeStoreAgent({ workspaceId: parsed.data.workspaceId });
  if (access instanceof NextResponse) return access;
  const { error } = await access.admin.from("store_agent_notes").upsert({
    workspace_id: parsed.data.workspaceId,
    content: parsed.data.content.trim(),
    updated_by: access.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: "Could not save the notes" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
