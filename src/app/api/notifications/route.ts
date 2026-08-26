import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceContext } from "@/lib/workspace-context";
import { jobHref, jobKindLabel } from "@/lib/jobs/href";
import { listActiveJobsForUser } from "@/lib/jobs/repo";
import type { AppNotification, JobInboxActiveRun } from "@/lib/jobs/types";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: notes, error } = await admin
    .from("notifications")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notifications = (notes ?? []) as AppNotification[];
  const unreadCount = notifications.filter((n) => !n.read_at).length;
  const activeRuns = await listActiveJobsForUser(admin, {
    workspaceId,
    userId: user.id,
  });

  const inProgress: JobInboxActiveRun[] = activeRuns.map((run) => {
    const slug = String(run.settings.workspaceSlug || "");
    return {
      id: run.id,
      kind: run.kind,
      sessionId: run.session_id,
      status: run.status,
      completedCount: run.completed_count,
      failedCount: run.failed_count,
      total: run.target_ids.length,
      href: slug
        ? jobHref({ kind: run.kind, workspaceSlug: slug, sessionId: run.session_id })
        : "/",
      sessionName: String(run.settings.sessionName || jobKindLabel(run.kind)),
      createdAt: run.created_at,
    };
  });

  return NextResponse.json({
    unreadCount,
    notifications,
    inProgress,
  });
}
