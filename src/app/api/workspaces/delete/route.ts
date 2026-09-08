import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { purgeWorkspace } from "@/lib/workspace-purge";
import { writeSecurityAuditLog } from "@/lib/security/audit-log";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { workspaceId } = await req.json();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: member } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (!member || member.role !== "owner") {
      return NextResponse.json({ error: "Only the workspace owner can delete it" }, { status: 403 });
    }

    const result = await purgeWorkspace(admin, workspaceId);
    await writeSecurityAuditLog(admin, {
      workspaceId,
      actorId: user.id,
      action: "workspace.delete",
      targetId: workspaceId,
      before: { workspace_id: workspaceId },
      after: {
        filesDeleted: result.filesDeleted,
        verifiedEmpty: result.verifiedEmpty,
        completed_at: new Date().toISOString(),
      },
      request: req,
    });
    return NextResponse.json({ success: true, filesDeleted: result.filesDeleted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
