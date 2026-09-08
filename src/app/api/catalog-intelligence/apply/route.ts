import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
} from "@/lib/workspace-context";
import { loadProjectJsonServer } from "@/lib/storage-helpers-server";
import {
  CatalogRevisionConflict,
  backfillWorkspaceProductsIfNeeded,
  loadCatalogProductsAdmin,
  loadCatalogRevision,
  saveCatalogWithCas,
} from "@/lib/catalog/persist";
import { productsRowStoreEnabled } from "@/lib/catalog/flag";
import { loadAllWorkspaceProducts } from "@/lib/catalog/row-store";
import { CATALOG_INTELLIGENCE } from "@/lib/product-modules";
import {
  PlanLimitError,
  assertProductQuota,
  planLimitResponse,
  upgradeUrlFor,
} from "@/lib/plan-limits";
import type { MasterProductJson } from "@/lib/storage-helpers";

export async function POST(request: Request) {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: session, error: sessionError } = await supabase
      .from("catalog_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const ctx = await getWorkspaceContext({
      workspaceId: session.workspace_id,
      userId: user.id,
    });
    if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
      return NextResponse.json({ error: "INACTIVE_SUBSCRIPTION" }, { status: 402 });
    }

    const project = await loadProjectJsonServer(session.workspace_id, sessionId);
    if (!project) {
      return NextResponse.json({ error: "Project data not found" }, { status: 404 });
    }

    const admin = createAdminClient();
    let updated = 0;
    let added = 0;
    let nextRevision = 0;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      updated = 0;
      added = 0;
      const expectedRevision = await loadCatalogRevision(admin, session.workspace_id);
      if (productsRowStoreEnabled()) {
        await backfillWorkspaceProductsIfNeeded(admin, session.workspace_id);
      }
      const masterProducts = productsRowStoreEnabled()
        ? await loadAllWorkspaceProducts(admin, session.workspace_id)
        : await loadCatalogProductsAdmin(admin, session.workspace_id);
      const masterMap = new Map(masterProducts.map((product) => [product.sku, product]));

      for (const row of project.rows) {
        const sku = row.originalData?.sku || row.originalData?.SKU || "";
        if (!sku) continue;

        if (masterMap.has(sku)) {
          const existing = masterMap.get(sku)!;
          masterMap.set(sku, {
            ...existing,
            data: { ...existing.data, ...row.originalData },
            enrichedData: {
              ...(existing.enrichedData || {}),
              ...(row.enrichedData || {}),
            },
          });
          updated += 1;
        } else {
          masterMap.set(sku, {
            sku,
            data: row.originalData || {},
            enrichedData: row.enrichedData || {},
            status: "active",
            createdAt: new Date().toISOString(),
          } satisfies MasterProductJson);
          added += 1;
        }
      }

      try {
        await assertProductQuota({
          workspaceId: session.workspace_id,
          incoming: added,
          currentOverride: masterProducts.length,
        });
      } catch (error) {
        if (error instanceof PlanLimitError) {
          return planLimitResponse(
            error,
            await upgradeUrlFor(admin, session.workspace_id)
          );
        }
        throw error;
      }

      try {
        nextRevision = await saveCatalogWithCas({
          admin,
          workspaceId: session.workspace_id,
          products: Array.from(masterMap.values()),
          expectedRevision,
        });
        break;
      } catch (error) {
        if (error instanceof CatalogRevisionConflict && attempt < 3) continue;
        if (error instanceof CatalogRevisionConflict) {
          return NextResponse.json(
            {
              code: error.code,
              error: error.message,
            },
            { status: 409 }
          );
        }
        throw error;
      }
    }

    await supabase
      .from("catalog_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    await supabase.from("activity_log").insert({
      workspace_id: session.workspace_id,
      user_id: user.id,
      action: "products_updated",
      entity_type: CATALOG_INTELLIGENCE.id,
      entity_id: sessionId,
      details: { updated, added, session_name: session.name, revision: nextRevision },
    });

    return NextResponse.json({ updated, added, revision: nextRevision });
  } catch (error: unknown) {
    console.error("Apply error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
