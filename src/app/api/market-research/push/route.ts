import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  pushBodySchema,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { collectionPushCostUsd } from "@/lib/market-research/cost";
import { getMrProject } from "@/lib/market-research/server-persist";
import { chargeMrWallet, refundMrWallet } from "@/lib/market-research/wallet-ops";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import { createShopifyCollection } from "@/lib/sync/providers/shopify/collections";
import {
  assignProductsToWooCategory,
  createWooCommerceCategory,
} from "@/lib/sync/providers/woocommerce/categories";
import type { IntegrationRecord } from "@/lib/sync/core/types";
import type {
  ProposedCollection,
  CollectionContent,
} from "@/components/market-research/workspace-data";

const SUPPORTED_PROVIDERS = new Set(["shopify", "woocommerce", "wordpress"]);

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

  // Load project collections and on-page content BEFORE any wallet write, so
  // we can validate the request is actually publishable first. A charge must
  // never happen for ids that don't exist or a store we can't publish to.
  let collections: ProposedCollection[] = [];
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
    console.error("[push] Could not load collections slice:", err);
    return jsonError("Could not load this project's collections. Please retry.", 500);
  }

  const collectionById = new Map(collections.map((c) => [c.id, c]));
  const unknownIds = ids.filter((id) => !collectionById.has(id));
  if (unknownIds.length > 0) {
    return jsonError(
      `Unknown collection id${unknownIds.length === 1 ? "" : "s"}: ${unknownIds.join(", ")}`,
      400
    );
  }

  // The duplicate check must have actually run and cleared these ids. If the
  // live-catalog fetch or the Gemini comparison failed earlier, the
  // collection is stamped dedupeCheckStatus "unknown" rather than "new" — it
  // could really be an unflagged duplicate, so publishing is blocked until
  // the merchant re-runs the check.
  const uncheckedIds = ids.filter(
    (id) => collectionById.get(id)?.dedupeCheckStatus === "unknown"
  );
  if (uncheckedIds.length > 0) {
    return jsonError(
      `The duplicate check couldn't be verified for ${uncheckedIds.length} collection${uncheckedIds.length === 1 ? "" : "s"} (the live catalog or AI comparison failed). Re-run the duplicate check before publishing.`,
      409
    );
  }

  let contentById: Record<string, CollectionContent> = {};
  try {
    const loadedContent = await loadProjectSliceAdmin<
      Record<string, CollectionContent>
    >(auth.admin, parsed.data.workspaceId, parsed.data.projectId, "content");
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

  if (!integrationRow || !integrationRow.provider) {
    return jsonError(
      "No connected store integration found. Connect a store before publishing.",
      409
    );
  }
  const provider = String(integrationRow.provider).toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return jsonError(`Unsupported store provider: ${provider}`, 409);
  }
  const integration = integrationRow as IntegrationRecord;

  // A collection that already has a store id was created on an earlier push.
  // Creating it again would put a second copy on the store and charge again.
  const alreadyPushedIds = ids.filter((id) => {
    const col = collectionById.get(id);
    return Boolean(col?.storeHandle || col?.storeCollectionId);
  });
  const toPush = ids.filter((id) => !alreadyPushedIds.includes(id));
  if (toPush.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        duplicate: false,
        chargedUsd: 0,
        refundedUsd: 0,
        remaining: undefined,
        pushedCount: 0,
        failedCount: 0,
        pushedIds: alreadyPushedIds,
        alreadyPushedIds,
        storeResults: [],
      },
      { headers: auth.headers }
    );
  }

  // Validation passed — hold the full amount. Any failed creates below are
  // refunded once we know the real outcome, so the customer is only ever
  // charged for collections that actually landed on their store.
  const amountUsd = collectionPushCostUsd(toPush.length);
  const charged = await chargeMrWallet(auth.admin, {
    workspaceId: parsed.data.workspaceId,
    userId: auth.user.id,
    amountUsd,
    description: `Push ${toPush.length} collection${toPush.length === 1 ? "" : "s"}`,
    idempotencyKey: `collection_push:hold:${parsed.data.projectId}:${toPush.join(",")}`,
    details: { projectId: parsed.data.projectId, collectionIds: toPush },
  });

  if (!charged.ok) {
    const status = charged.reason === "insufficient_funds" ? 402 : 500;
    return NextResponse.json(
      { error: charged.message || "Not enough wallet balance" },
      { status, headers: auth.headers }
    );
  }

  const createdStoreResults: Array<{
    id: string;
    name: string;
    storeTitle?: string;
    handle?: string;
    storeCollectionId?: string;
    success: boolean;
    error?: string;
  }> = [];

  for (let i = 0; i < toPush.length; i += 1) {
    const colId = toPush[i]!;
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const col = collectionById.get(colId);
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
      const wooProductIds = (col?.matchedProductIds ?? []).filter((pid) =>
        /^\d+$/.test(pid)
      );

      try {
        const res = await createWooCommerceCategory({
          integration,
          category: {
            name: storeTitle,
            description: content?.collectionDescription || undefined,
          },
        });
        if (wooProductIds.length > 0 && res.id) {
          try {
            await assignProductsToWooCategory({
              integration,
              categoryId: String(res.id),
              productIds: wooProductIds,
            });
          } catch (assignErr) {
            // A category with none of its products is not a delivered
            // collection: report it failed so it is refunded, not charged.
            const msg =
              assignErr instanceof Error ? assignErr.message : "Product assignment failed";
            console.error(
              `[push] WooCommerce category "${storeTitle}" created but product assignment failed:`,
              assignErr
            );
            createdStoreResults.push({
              id: colId,
              name: colName,
              storeTitle,
              success: false,
              error: `Category created without products: ${msg}`,
            });
            continue;
          }
        }
        createdStoreResults.push({
          id: colId,
          name: colName,
          storeTitle,
          handle: res.slug ? String(res.slug) : undefined,
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

  const successResults = createdStoreResults.filter((r) => r.success);
  const failedResults = createdStoreResults.filter((r) => !r.success);

  // Refund exactly the failed collections. Successful ones keep their hold.
  let remaining = charged.remaining;
  let refundedUsd = 0;
  if (failedResults.length > 0) {
    const failedIds = failedResults.map((r) => r.id).sort();
    refundedUsd = collectionPushCostUsd(failedIds.length);
    const refunded = await refundMrWallet(auth.admin, {
      workspaceId: parsed.data.workspaceId,
      userId: auth.user.id,
      amountUsd: refundedUsd,
      description: `Push refund · ${failedIds.length} collection${failedIds.length === 1 ? "" : "s"} failed to create`,
      idempotencyKey: `collection_push:refund:${parsed.data.projectId}:${failedIds.join(",")}`,
      details: { projectId: parsed.data.projectId, collectionIds: failedIds },
    });
    if (refunded.ok) {
      remaining = refunded.remaining;
    } else {
      console.error("[push] Failed to refund failed collection creates:", refunded.message);
    }
  }

  // Persist the real store handles back into the collections slice. The widget
  // embed API matches on these exact handles, so without them it cannot tell
  // an AI collection page apart from a pre-existing store collection page.
  const handleUpdates = successResults.filter((r) => r.handle || r.storeCollectionId);
  if (handleUpdates.length > 0 && collections.length > 0) {
    const byId = new Map(handleUpdates.map((r) => [r.id, r]));
    const nextCollections = collections.map((col) => {
      const update = byId.get(col.id);
      if (!update) return col;
      return {
        ...col,
        ...(update.handle ? { storeHandle: update.handle } : {}),
        ...(update.storeCollectionId
          ? { storeCollectionId: update.storeCollectionId }
          : {}),
      };
    });

    try {
      await saveProjectSliceAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "collections",
        nextCollections
      );
    } catch (err) {
      console.error("[push] Failed to persist store handles:", err);
    }
  }

  return NextResponse.json(
    {
      ok: failedResults.length === 0,
      duplicate: false,
      chargedUsd: amountUsd - refundedUsd,
      refundedUsd,
      remaining,
      pushedCount: successResults.length,
      failedCount: failedResults.length,
      pushedIds: [...alreadyPushedIds, ...successResults.map((r) => r.id)],
      alreadyPushedIds,
      storeResults: createdStoreResults,
    },
    { headers: auth.headers }
  );
}
