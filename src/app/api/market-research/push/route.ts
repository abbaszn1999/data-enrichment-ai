import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  pushBodySchema,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { collectionPushCostUsd } from "@/lib/market-research/cost";
import { getMrProject } from "@/lib/market-research/server-persist";
import { chargeMrWallet } from "@/lib/market-research/wallet-ops";
import { loadProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import { createShopifyCollection } from "@/lib/sync/providers/shopify/collections";
import { createWooCommerceCategory } from "@/lib/sync/providers/woocommerce/categories";
import type { IntegrationRecord } from "@/lib/sync/core/types";
import type {
  ProposedCollection,
  CollectionContent,
} from "@/components/market-research/workspace-data";

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = pushBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid push payload", 400);

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  const project = await getMrProject(
    auth.admin,
    parsed.data.workspaceId,
    parsed.data.projectId
  );
  if (!project) return jsonError("Project not found", 404);

  const ids = [...parsed.data.collectionIds].sort();
  const amountUsd = collectionPushCostUsd(ids.length);
  const charged = await chargeMrWallet(auth.admin, {
    workspaceId: parsed.data.workspaceId,
    userId: auth.user.id,
    amountUsd,
    description: `Push ${ids.length} collection${ids.length === 1 ? "" : "s"}`,
    idempotencyKey: `collection_push:${parsed.data.projectId}:${ids.join(",")}`,
    details: { projectId: parsed.data.projectId, collectionIds: ids },
  });

  if (!charged.ok) {
    const status = charged.reason === "insufficient_funds" ? 402 : 500;
    return NextResponse.json(
      { error: charged.message || "Not enough wallet balance" },
      { status, headers: auth.headers }
    );
  }

  // Note: Even if charged.duplicate is true (wallet already billed for these IDs),
  // we proceed to ensure collections exist on the connected store.

  // Load project collections and on-page content
  let collections: ProposedCollection[] = [];
  let contentById: Record<string, CollectionContent> = {};

  try {
    const loadedCols = await loadProjectSliceAdmin<ProposedCollection[]>(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "collections"
    );
    if (Array.isArray(loadedCols)) {
      collections = loadedCols;
    }
  } catch (err) {
    console.warn("[push] Could not load collections slice:", err);
  }

  try {
    const loadedContent = await loadProjectSliceAdmin<
      Record<string, CollectionContent>
    >(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "content"
    );
    if (loadedContent && typeof loadedContent === "object") {
      contentById = loadedContent;
    }
  } catch {
    // Content might not have been generated yet if pushed in Stage 5
  }

  // Fetch active store integration and workspace prefix for this workspace
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

  const createdStoreResults: Array<{
    id: string;
    name: string;
    storeTitle?: string;
    handle?: string;
    storeCollectionId?: string;
    success: boolean;
    error?: string;
  }> = [];

  if (integrationRow && integrationRow.provider) {
    const integration = integrationRow as IntegrationRecord;
    const provider = String(integration.provider).toLowerCase();

    for (const colId of ids) {
      const col = collections.find((c) => c.id === colId);
      const colName = col?.name || colId;
      const storeTitle = `${prefix} - ${colName}`;
      const content = contentById[colId];

      if (provider === "shopify") {
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

        try {
          const res = await createShopifyCollection({
            integration,
            input: {
              title: storeTitle,
              type: "manual",
              descriptionHtml: content?.collectionDescription || undefined,
              productIds: shopifyProductIds,
            },
          });
          createdStoreResults.push({
            id: colId,
            name: colName,
            storeTitle,
            handle: res.handle,
            storeCollectionId: res.id,
            success: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Shopify creation error";
          console.error(`[push] Failed to create Shopify collection "${storeTitle}":`, msg);
          createdStoreResults.push({
            id: colId,
            name: colName,
            storeTitle,
            success: false,
            error: msg,
          });
        }
      } else if (provider === "woocommerce" || provider === "wordpress") {
        try {
          const res = await createWooCommerceCategory({
            integration,
            category: {
              name: storeTitle,
              description: content?.collectionDescription || undefined,
            },
          });
          createdStoreResults.push({
            id: colId,
            name: colName,
            storeTitle,
            storeCollectionId: String(res.id),
            success: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "WooCommerce creation error";
          console.error(`[push] Failed to create WooCommerce category "${storeTitle}":`, msg);
          createdStoreResults.push({
            id: colId,
            name: colName,
            storeTitle,
            success: false,
            error: msg,
          });
        }
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      duplicate: false,
      chargedUsd: amountUsd,
      remaining: charged.remaining,
      pushedCount: ids.length,
      storeResults: createdStoreResults,
    },
    { headers: auth.headers }
  );
}
