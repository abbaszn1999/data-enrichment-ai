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
  createShopifyCollection,
} from "@/lib/sync/providers/shopify/collections";
import {
  fetchWooCommerceCategories,
  updateWooCommerceCategories,
  createWooCommerceCategory,
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

    const targetCollectionIds =
      parsed.data.collectionIds && parsed.data.collectionIds.length > 0
        ? parsed.data.collectionIds
        : collections.map((c) => c.id);

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

    if (provider === "shopify") {
      for (const colId of targetCollectionIds) {
        const col = collections.find((c) => c.id === colId);
        const colName = col?.name || colId;
        const storeTitle = `${prefix} - ${colName}`;
        const content = contentById[colId];

        if (!content) continue;

        try {
          const resolved = await resolveCollectionByName({
            integration,
            name: storeTitle,
          });

          if (resolved?.id) {
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
            } else if (updateRes.errors.length > 0) {
              errors.push(...updateRes.errors);
            }
          } else {
            // If not found on Shopify, create it
            const rawProductIds = col?.matchedProductIds ?? [];
            const shopifyProductIds = rawProductIds
              .map((pid) =>
                pid.startsWith("gid://shopify/Product/")
                  ? pid
                  : /^\d+$/.test(pid)
                  ? `gid://shopify/Product/${pid}`
                  : ""
              )
              .filter(Boolean);

            const createRes = await createShopifyCollection({
              integration,
              input: {
                title: storeTitle,
                type: "manual",
                descriptionHtml: content.collectionDescription,
                productIds: shopifyProductIds,
              },
            });

            // Update SEO for the newly created collection
            await applyShopifyCollectionUpdates({
              integration,
              updates: [
                {
                  row: {
                    id: createRes.id,
                    title: storeTitle,
                    description: content.collectionDescription,
                    seo_title: content.seoTitle,
                    seo_description: content.seoDescription,
                  },
                  changedColumns: ["seo_title", "seo_description"],
                },
              ],
            });
            syncedCount += 1;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Shopify sync error";
          errors.push(`[${storeTitle}] ${msg}`);
        }
      }
    } else if (provider === "woocommerce" || provider === "wordpress") {
      const wooSheet = await fetchWooCommerceCategories({ integration, limit: 100 });
      const wooRows = wooSheet.rows;

      for (const colId of targetCollectionIds) {
        const col = collections.find((c) => c.id === colId);
        const colName = col?.name || colId;
        const storeTitle = `${prefix} - ${colName}`;
        const content = contentById[colId];

        if (!content) continue;

        try {
          const matched = wooRows.find(
            (r) => String(r.name).toLowerCase() === storeTitle.toLowerCase()
          );

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
            if (updateRes.updatedCount > 0) syncedCount += 1;
            if (updateRes.errors.length > 0) errors.push(...updateRes.errors);
          } else {
            await createWooCommerceCategory({
              integration,
              category: {
                name: storeTitle,
                description: content.collectionDescription,
              },
            });
            syncedCount += 1;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "WooCommerce sync error";
          errors.push(`[${storeTitle}] ${msg}`);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      syncedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[api/market-research/sync-seo] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to sync SEO to store";
    return jsonError(msg, 500);
  }
}
