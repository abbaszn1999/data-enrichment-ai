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
import {
  countWorkspaceProducts,
  countWorkspaceProductsMatching,
  extractProductColumns,
  listWorkspaceProducts,
  loadAllWorkspaceProducts,
  loadProductColumns,
} from "@/lib/catalog/row-store";
import { invalidateCachedCounts } from "@/lib/storage-helpers-server";
import type { MasterProductJson } from "@/lib/storage-helpers";

async function requireMember(workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, ctx };
}

function paginateBlob(
  products: MasterProductJson[],
  limit: number,
  cursor: string | null,
  search: string
) {
  const needle = search.trim().toLowerCase();
  let filtered = products;
  if (needle) {
    filtered = products.filter(
      (p) =>
        p.sku.toLowerCase().includes(needle) ||
        Object.values(p.data || {}).some((v) => String(v).toLowerCase().includes(needle))
    );
  }
  filtered = [...filtered].sort((a, b) => a.sku.localeCompare(b.sku));
  const start = cursor ? filtered.findIndex((p) => p.sku > cursor) : 0;
  const from = start < 0 ? filtered.length : start;
  const slice = filtered.slice(from, from + limit + 1);
  const hasMore = slice.length > limit;
  const items = hasMore ? slice.slice(0, limit) : slice;
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.sku ?? null : null,
    hasMore,
    total: filtered.length,
    catalogTotal: products.length,
    columns: extractProductColumns(products),
  };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const auth = await requireMember(workspaceId);
  if ("error" in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get("limit") || "20") || 20;
  const cursor = request.nextUrl.searchParams.get("cursor");
  const search = request.nextUrl.searchParams.get("search") || "";
  const admin = createAdminClient();
  const revision = await loadCatalogRevision(admin, workspaceId);

  try {
    if (productsRowStoreEnabled()) {
      await backfillWorkspaceProductsIfNeeded(admin, workspaceId);
      const [page, total, catalogTotal, columns] = await Promise.all([
        listWorkspaceProducts({
          admin,
          workspaceId,
          limit,
          cursor,
          search,
        }),
        countWorkspaceProductsMatching({ admin, workspaceId, search }),
        countWorkspaceProducts(admin, workspaceId),
        loadProductColumns(admin, workspaceId),
      ]);
      return NextResponse.json({
        items: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        total,
        catalogTotal,
        columns,
        revision,
      });
    }

    const products = await loadCatalogProductsAdmin(admin, workspaceId);
    return NextResponse.json({
      ...paginateBlob(products, Math.min(Math.max(limit, 1), 100), cursor, search),
      revision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load products";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let body: { workspaceId?: string; skus?: string[]; all?: boolean };
  try {
    body = (await request.json()) as { workspaceId?: string; skus?: string[]; all?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const auth = await requireMember(workspaceId);
  if ("error" in auth) return auth.error;
  if (auth.ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!auth.ctx.subscription || !isContextSubscriptionActive(auth.ctx)) {
    return NextResponse.json({ error: "INACTIVE_SUBSCRIPTION" }, { status: 402 });
  }

  const admin = createAdminClient();
  const expectedRevision = await loadCatalogRevision(admin, workspaceId);

  try {
    if (!body.all && !(body.skus ?? []).length) {
      return NextResponse.json({ error: "skus is required" }, { status: 400 });
    }
    const remove = new Set(body.skus ?? []);
    const current = productsRowStoreEnabled()
      ? await (async () => {
          await backfillWorkspaceProductsIfNeeded(admin, workspaceId);
          return loadAllWorkspaceProducts(admin, workspaceId);
        })()
      : await loadCatalogProductsAdmin(admin, workspaceId);
    const remaining = body.all
      ? []
      : current.filter((p) => !remove.has(p.sku));

    const revision = await saveCatalogWithCas({
      admin,
      workspaceId,
      products: remaining,
      expectedRevision,
    });
    invalidateCachedCounts(workspaceId);
    return NextResponse.json({
      ok: true,
      revision,
      count: remaining.length,
    });
  } catch (error) {
    if (error instanceof CatalogRevisionConflict) {
      const currentRevision = await loadCatalogRevision(admin, workspaceId);
      return NextResponse.json(
        { code: error.code, error: error.message, currentRevision },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to delete products";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
