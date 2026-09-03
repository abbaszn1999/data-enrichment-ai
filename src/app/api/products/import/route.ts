import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
} from "@/lib/workspace-context";
import {
  CatalogRevisionConflict,
  backfillWorkspaceProductsIfNeeded,
  loadCatalogProductsAdmin,
  loadCatalogRevision,
  saveCatalogWithCas,
} from "@/lib/catalog/persist";
import { productsRowStoreEnabled } from "@/lib/catalog/flag";
import { loadAllWorkspaceProducts } from "@/lib/catalog/row-store";
import {
  incomingQuotaDelta,
  mergeImportedProducts,
  type ProductDupMode,
} from "@/lib/catalog/import-merge";
import {
  PlanLimitError,
  assertProductQuota,
  planLimitResponse,
  upgradeUrlFor,
} from "@/lib/plan-limits";
import { invalidateCachedCounts } from "@/lib/storage-helpers-server";
import type { MasterProductJson } from "@/lib/storage-helpers";

const DUP_MODES: ProductDupMode[] = ["skip", "update", "new"];

export async function POST(request: NextRequest) {
  let body: {
    workspaceId?: string;
    products?: MasterProductJson[];
    dupMode?: ProductDupMode;
    emptySkuCount?: number;
    clearEmptyFields?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  const incoming = Array.isArray(body.products) ? body.products : null;
  const dupMode = body.dupMode;
  if (!workspaceId || !incoming || !dupMode || !DUP_MODES.includes(dupMode)) {
    return NextResponse.json(
      { error: "workspaceId, products, and dupMode are required" },
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
    if (productsRowStoreEnabled()) {
      await backfillWorkspaceProductsIfNeeded(admin, workspaceId);
    }
    const existing = productsRowStoreEnabled()
      ? await loadAllWorkspaceProducts(admin, workspaceId)
      : await loadCatalogProductsAdmin(admin, workspaceId);
    const existingSkus = new Set(existing.map((p) => p.sku));
    await assertProductQuota({
      workspaceId,
      incoming: incomingQuotaDelta(existingSkus, incoming, dupMode),
      currentOverride: existing.length,
    });

    const merged = mergeImportedProducts({
      existing,
      incoming,
      dupMode,
      clearEmptyFields: dupMode === "update" && body.clearEmptyFields === true,
    });
    const revision = await saveCatalogWithCas({
      admin,
      workspaceId,
      products: merged.products,
      expectedRevision: await loadCatalogRevision(admin, workspaceId),
    });
    invalidateCachedCounts(workspaceId);
    return NextResponse.json({
      ok: true,
      revision,
      imported: merged.imported,
      skipped: merged.skipped + (body.emptySkuCount ?? 0),
      updated: merged.updated,
      count: merged.products.length,
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return planLimitResponse(error, await upgradeUrlFor(admin, workspaceId));
    }
    if (error instanceof CatalogRevisionConflict) {
      const currentRevision = await loadCatalogRevision(admin, workspaceId);
      return NextResponse.json(
        { code: error.code, error: error.message, currentRevision },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
