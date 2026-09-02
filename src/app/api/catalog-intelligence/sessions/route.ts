import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
} from "@/lib/workspace-context";
import {
  PlanLimitError,
  assertImportQuota,
  planLimitResponse,
  upgradeUrlFor,
} from "@/lib/plan-limits";
import {
  UploadLimitError,
  UPLOAD_LIMITS,
  assertRowCount,
} from "@/lib/upload-limits";
import type { SessionKind } from "@/types";

type Body = {
  workspaceId?: string;
  name?: string;
  notes?: string;
  total_rows?: number;
  kind?: SessionKind;
};

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  const name = body.name?.trim();
  const totalRows = Number(body.total_rows ?? 0);
  if (!workspaceId || !name) {
    return NextResponse.json(
      { error: "workspaceId and name are required" },
      { status: 400 }
    );
  }

  try {
    assertRowCount(totalRows, "catalogIntelligence");
  } catch (error) {
    const message =
      error instanceof UploadLimitError ? error.message : "Row limit exceeded";
    return NextResponse.json({ error: message, code: "upload_limit_exceeded" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
    return NextResponse.json({ error: "INACTIVE_SUBSCRIPTION" }, { status: 402 });
  }

  const admin = createAdminClient();
  try {
    await assertImportQuota({ workspaceId });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return planLimitResponse(error, await upgradeUrlFor(admin, workspaceId));
    }
    throw error;
  }

  const { data, error } = await admin
    .from("catalog_sessions")
    .insert({
      workspace_id: workspaceId,
      created_by: user.id,
      name,
      notes: body.notes ?? "",
      total_rows: totalRows,
      kind: body.kind ?? "product",
    })
    .select()
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Could not create session" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      session: data,
      limits: { maxRows: UPLOAD_LIMITS.catalogIntelligence.maxRows },
    },
    { status: 201 }
  );
}
