import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeStoreAgent } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ workspaceId: z.string().uuid(), autoRun: z.boolean() });

/** Auto-run: apply store edits without asking. Deletes always ask; bulk changes run on their own only for owners and admins. */
export async function PUT(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const access = await authorizeStoreAgent({ workspaceId: parsed.data.workspaceId });
  if (access instanceof NextResponse) return access;
  const { error } = await access.admin.from("store_agent_prefs").upsert(
    {
      workspace_id: parsed.data.workspaceId,
      user_id: access.userId,
      auto_run: parsed.data.autoRun,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,user_id" }
  );
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });
  return NextResponse.json({ ok: true, autoRun: parsed.data.autoRun });
}
