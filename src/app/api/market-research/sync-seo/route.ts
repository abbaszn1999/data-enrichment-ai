import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  jsonError,
  requireMrWrite,
  workspaceIdSchema,
  projectIdSchema,
} from "@/lib/market-research/api-schema";
import { loadProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import {
  resolveCollectionByName,
  applyShopifyCollectionUpdates,
  publishCollectionToOnlineStore,
} from "@/lib/sync/providers/shopify/collections";
import {
  resolveWooCategoryByName,
  updateWooCommerceCategories,
} from "@/lib/sync/providers/woocommerce/categories";
import type { IntegrationRecord } from "@/lib/sync/core/types";
import type {
  ProposedCollection,
  CollectionContent,
} from "@/components/market-research/workspace-data";

const syncSeoBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  collectionIds: z.array(z.string()).optional(),
});

export const maxDuration = 60;

const NOT_ON_STORE = "Not on the store yet. Push this collection first.";

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = syncSeoBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid payload", 400);

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    // Load collections and content slices
    const [collectionsRes, contentRes] = await Promise.all([
      loadProjectSliceAdmin<ProposedCollection[]>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "collections"
      ).catch(() => [] as ProposedCollection[]),
      loadProjectSliceAdmin<Record<string, CollectionContent>>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "content"
      ).catch(() => ({}) as Record<string, CollectionContent>),
    ]);

    const collections = Array.isArray(collectionsRes) ? collectionsRes : [];
    const contentById = contentRes && typeof contentRes === "object" ? contentRes : {};

    // By default only collections already on the store; projects pushed
    // before store ids were saved fall back to every collection.
    const pushed = collections.filter((c) => c.storeHandle || c.storeCollectionId);
    const targetCollectionIds =
      parsed.data.collectionIds && parsed.data.collectionIds.length > 0
        ? parsed.data.collectionIds
        : (pushed.length > 0 ? pushed : collections).map((c) => c.id);

    if (targetCollectionIds.length === 0) {
      return NextResponse.json({ ok: true, syncedCount: 0, message: "No collections to sync" });
    }

    // Fetch active store integration and workspace prefix
    const [integrationResult, wsResult] = await Promise.all([
      auth.admin
        .from("workspace_integrations")
        .select("provider, integration_name, base_url, config")
        .eq("workspace_id", parsed.data.workspaceId)
        .maybeSingle(),
      auth.admin
        .from("workspaces")
        .select("collection_prefix")
        .eq("id", parsed.data.workspaceId)
        .maybeSingle(),
    ]);

    const integrationRow = integrationResult.data;
    const prefix = (wsResult.data?.collection_prefix ?? "AI").trim() || "AI";

    if (!integrationRow || !integrationRow.provider) {
      return NextResponse.json({
        ok: true,
        syncedCount: 0,
        message: "No store integration connected. Content saved to project.",
      });
    }

    const integration = integrationRow as IntegrationRecord;
    const provider = String(integration.provider).toLowerCase();

    let syncedCount = 0;
    const errors: string[] = [];
    // Per-collection outcome, so the table can show which rows are actually
    // live instead of one aggregate count for the whole batch.
    const results: Array<{
      collectionId: string;
      ok: boolean;
      error?: string;
    }> = [];

    if (provider === "shopify") {
      for (const colId of targetCollectionIds) {
        const col = collections.find((c) => c.id === colId);
        const colName = col?.name || colId;
        const storeTitle = `${prefix} - ${colName}`;
        const content = contentById[colId];

        if (!content) {
          results.push({
            collectionId: colId,
            ok: false,
            error: "No copy generated for this collection",
          });
          continue;
        }

        try {
          const resolved = await resolveCollectionByName({
            integration,
            name: storeTitle,
          });

          if (resolved?.id) {
            // Collections pushed before publishing was wired up are invisible on
            // the storefront, so repair them on every sync. The call is idempotent.
            await publishCollectionToOnlineStore({
              integration,
              collectionId: resolved.id,
            });

            const updateRes = await applyShopifyCollectionUpdates({
              integration,
              updates: [
                {
                  row: {
                    id: resolved.id,
                    title: storeTitle,
                    description: content.collectionDescription,
                    seo_title: content.seoTitle,
                    seo_description: content.seoDescription,
                  },
                  changedColumns: ["description", "seo_title", "seo_description"],
                },
              ],
            });
            if (updateRes.updatedCount > 0) {
              syncedCount += 1;
              results.push({ collectionId: colId, ok: true });
            } else if (updateRes.errors.length > 0) {
              errors.push(...updateRes.errors);
              results.push({
                collectionId: colId,
                ok: false,
                error: updateRes.errors[0],
              });
            } else {
              // Shopify already held this exact copy: nothing changed, but the
              // store is up to date, which is what the row is reporting.
              results.push({ collectionId: colId, ok: true });
            }
          } else {
            // Creating collections is the paid push step, never a side effect
            // of syncing copy.
            results.push({ collectionId: colId, ok: false, error: NOT_ON_STORE });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Shopify sync error";
          errors.push(`[${storeTitle}] ${msg}`);
          results.push({ collectionId: colId, ok: false, error: msg });
        }
      }
    } else if (provider === "woocommerce" || provider === "wordpress") {
      for (const colId of targetCollectionIds) {
        const col = collections.find((c) => c.id === colId);
        const colName = col?.name || colId;
        const storeTitle = `${prefix} - ${colName}`;
        const content = contentById[colId];

        if (!content) {
          results.push({
            collectionId: colId,
            ok: false,
            error: "No copy generated for this collection",
          });
          continue;
        }

        try {
          // The id saved at push time, else an exact name match found by
          // search, so stores with many categories still resolve correctly.
          let matched: { id: string } | null = col?.storeCollectionId
            ? { id: String(col.storeCollectionId) }
            : null;
          if (!matched) {
            const found = await resolveWooCategoryByName({ integration, name: storeTitle });
            matched =
              found && (found.title ?? "").toLowerCase() === storeTitle.toLowerCase()
                ? { id: found.id }
                : null;
          }

          if (matched && matched.id) {
            const updateRes = await updateWooCommerceCategories({
              integration,
              updates: [
                {
                  id: String(matched.id),
                  row: {
                    id: String(matched.id),
                    description: content.collectionDescription,
                  },
                  changedColumns: ["description"],
                },
              ],
            });
            if (updateRes.errors.length > 0) {
              errors.push(...updateRes.errors);
              results.push({
                collectionId: colId,
                ok: false,
                error: updateRes.errors[0],
              });
            } else {
              if (updateRes.updatedCount > 0) syncedCount += 1;
              results.push({ collectionId: colId, ok: true });
            }
          } else {
            results.push({ collectionId: colId, ok: false, error: NOT_ON_STORE });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "WooCommerce sync error";
          errors.push(`[${storeTitle}] ${msg}`);
          results.push({ collectionId: colId, ok: false, error: msg });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      syncedCount,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[api/market-research/sync-seo] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to sync SEO to store";
    return jsonError(msg, 500);
  }
}
