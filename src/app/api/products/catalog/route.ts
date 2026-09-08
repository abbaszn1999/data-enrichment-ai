import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
} from "@/lib/workspace-context";
import {
  CatalogRevisionConflict,
  loadCatalogRevision,
  saveCatalogWithCas,
} from "@/lib/catalog/persist";
import {
  PlanLimitError,
  assertProductQuota,
  planLimitResponse,
  upgradeUrlFor,
} from "@/lib/plan-limits";
import { invalidateCachedCounts } from "@/lib/storage-helpers-server";
import type { MasterProductJson } from "@/lib/storage-helpers";

type Body = {
  workspaceId?: string;
  products?: MasterProductJson[];
  expectedRevision?: number;
};

export async function PUT(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId || !Array.isArray(body.products)) {
    return NextResponse.json(
      { error: "workspaceId and products are required" },
      { status: 400 }
    );
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
    await assertProductQuota({
      workspaceId,
      incoming: 0,
      currentOverride: body.products.length,
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return planLimitResponse(error, await upgradeUrlFor(admin, workspaceId));
    }
    throw error;
  }

  const expectedRevision =
    typeof body.expectedRevision === "number"
      ? body.expectedRevision
      : await loadCatalogRevision(admin, workspaceId);

  try {
    const revision = await saveCatalogWithCas({
      admin,
      workspaceId,
      products: body.products,
      expectedRevision,
    });
    invalidateCachedCounts(workspaceId);
    return NextResponse.json({ ok: true, revision, count: body.products.length });
  } catch (error) {
    if (error instanceof CatalogRevisionConflict) {
      const currentRevision = await loadCatalogRevision(admin, workspaceId);
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          currentRevision,
        },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to save catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
