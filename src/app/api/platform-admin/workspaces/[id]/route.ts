import { NextResponse } from "next/server";
import { loadLiveWorkspaceDetail } from "@/lib/platform-admin/live";
import { requirePlatformAdmin } from "@/lib/platform-admin/server-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { purgeWorkspace } from "@/lib/workspace-purge";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const workspace = await loadLiveWorkspaceDetail(id);
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    return NextResponse.json({ workspace });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load workspace" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = await requirePlatformAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const confirm = String(body.confirm || "").trim().toLowerCase();

  try {
    const admin = createAdminClient();
    const { data: workspace } = await admin.from("workspaces").select("id, slug, name").eq("id", id).maybeSingle();
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    const slug = String(workspace.slug || "").toLowerCase();
    if (!slug || confirm !== slug) {
      return NextResponse.json({ error: "Type the workspace slug to confirm deletion." }, { status: 400 });
    }
    const result = await purgeWorkspace(admin, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete workspace" },
      { status: 500 }
    );
  }
}
