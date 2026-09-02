import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
} from "@/lib/workspace-context";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { insertJobRun, loadActiveJobForSession } from "@/lib/jobs/repo";
import { loadProjectJsonAdmin } from "@/lib/jobs/project-json";
import type { CatalogJobSettings } from "@/lib/jobs/types";
import type { SessionKind } from "@/types";

export const maxDuration = 60;

type Body = {
  workspaceId?: string;
  sessionId?: string;
  rowIds?: string[];
  enabledColumns?: string[];
  enrichmentColumns?: CatalogJobSettings["enrichmentColumns"];
  settings?: { enrichmentModel?: string; outputLanguage?: string };
  kind?: SessionKind;
  cmsType?: string;
  sourceColumns?: string[];
  workspaceCategories?: CatalogJobSettings["workspaceCategories"];
  categoriesRawRows?: Record<string, string>[];
};

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  const sessionId = body.sessionId?.trim();
  if (!workspaceId || !sessionId) {
    return NextResponse.json(
      { error: "workspaceId and sessionId are required" },
      { status: 400 }
    );
  }
  if (!body.enabledColumns?.length) {
    return NextResponse.json(
      { error: "No enrichment columns selected" },
      { status: 400 }
    );
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
  const headers = {
    "X-Context-Source": ctx.source,
    "Server-Timing": `ctx;dur=${ctx.durationMs.toFixed(1)}`,
  };
  if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
    return NextResponse.json(
      { error: "INACTIVE_SUBSCRIPTION" },
      { status: 402, headers }
    );
  }
  if ((ctx.credits?.total ?? 0) <= 0) {
    return NextResponse.json({ error: "NO_CREDITS" }, { status: 402, headers });
  }

  const admin = createAdminClient();
  const existing = await loadActiveJobForSession(admin, {
    kind: "catalog",
    sessionId,
    workspaceId,
  });
  if (existing) {
    return NextResponse.json(
      { error: "An enrichment run is already in progress", runId: existing.id },
      { status: 409, headers }
    );
  }

  const { data: session, error: sessionError } = await admin
    .from("catalog_sessions")
    .select("id, name, workspace_id")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404, headers });
  }

  const { data: workspace } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .single();

  const project = await loadProjectJsonAdmin(workspaceId, sessionId, admin);
  if (!project) {
    return NextResponse.json({ error: "Project data not found" }, { status: 404, headers });
  }

  const requested = body.rowIds?.length
    ? [...new Set(body.rowIds)]
    : project.rows.filter((row) => row.status !== "done").map((row) => row.id);
  const known = new Set(project.rows.map((row) => row.id));
  const targetIds = requested.filter((id) => known.has(id));
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "No rows to enrich" }, { status: 400, headers });
  }

  const kind: SessionKind = body.kind === "plp" ? "plp" : "product";
  const settings: CatalogJobSettings = {
    workspaceSlug: workspace?.slug,
    sessionName: session.name,
    kind,
    enabledColumns: body.enabledColumns,
    enrichmentColumns: body.enrichmentColumns ?? [],
    enrichmentModel: body.settings?.enrichmentModel,
    outputLanguage: body.settings?.outputLanguage || "English",
    cmsType: body.cmsType,
    sourceColumns: body.sourceColumns?.length ? body.sourceColumns : project.sourceColumns,
    workspaceCategories: body.workspaceCategories,
    categoriesRawRows: body.categoriesRawRows,
    ownerUserId: ctx.subscription.user_id ?? ctx.ownerId ?? user.id,
    actorUserId: user.id,
  };

  const job = await insertJobRun(admin, {
    workspaceId,
    kind: "catalog",
    sessionId,
    createdBy: user.id,
    targetIds,
    settings,
  });

  await admin
    .from("catalog_sessions")
    .update({ status: "enriching", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId);

  await dispatchJob(job.id, "catalog");

  return NextResponse.json(
    { runId: job.id, status: "running", total: targetIds.length },
    { status: 202, headers }
  );
}
