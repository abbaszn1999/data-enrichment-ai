import { NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  pushBodySchema,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import { COLLECTION_PUSH_USD, collectionPushCostUsd, roundUsd } from "@/lib/market-research/cost";
import { getMrProject } from "@/lib/market-research/server-persist";
import { chargeMrWallet, refundMrWallet } from "@/lib/market-research/wallet-ops";
import {
  loadProjectSliceAdmin,
  saveProjectSliceAdmin,
} from "@/lib/market-research/storage-admin";
import { readWorkspaceWallet } from "@/lib/wallet/server";
import {
  createShopifyCollection,
  resolveCollectionByName,
} from "@/lib/sync/providers/shopify/collections";
import {
  assignProductsToWooCategory,
  createWooCommerceCategory,
  deleteWooCategories,
  resolveWooCategoryByName,
} from "@/lib/sync/providers/woocommerce/categories";
import type { IntegrationRecord } from "@/lib/sync/core/types";
import type {
  ProposedCollection,
  CollectionContent,
} from "@/components/market-research/workspace-data";

const SUPPORTED_PROVIDERS = new Set(["shopify", "woocommerce", "wordpress"]);

/**
 * Store ids of collections created on the store, written right after each
 * create. If the request dies mid-push, the next push still knows what is
 * already live and neither creates a second copy nor charges again.
 */
type PushLedger = Record<string, { handle?: string; storeCollectionId?: string }>;

type StoreResult = {
  id: string;
  name: string;
  storeTitle?: string;
  handle?: string;
  storeCollectionId?: string;
  success: boolean;
  error?: string;
};

/**
 * A collection with this exact title is already on the store: made by a
 * concurrent push, or by an earlier one that died before recording it. It is
 * adopted without a charge instead of being created a second time. A failed
 * lookup never blocks the push.
 */
async function findOnStore(
  provider: string,
  integration: IntegrationRecord,
  storeTitle: string
): Promise<{ handle?: string; storeCollectionId: string } | null> {
  try {
    const found =
      provider === "shopify"
        ? await resolveCollectionByName({ integration, name: storeTitle })
        : await resolveWooCategoryByName({ integration, name: storeTitle });
    if (!found?.id || (found.title ?? "").toLowerCase() !== storeTitle.toLowerCase()) return null;
    return { storeCollectionId: String(found.id), ...(found.handle ? { handle: found.handle } : {}) };
  } catch {
    return null;
  }
}

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

  const { workspaceId, projectId } = parsed.data;
  const project = await getMrProject(auth.admin, workspaceId, projectId);
  if (!project) return jsonError("Project not found", 404);

  const ids = [...parsed.data.collectionIds].sort();

  // Load project collections and on-page content BEFORE any wallet write, so
  // we can validate the request is actually publishable first. A charge must
  // never happen for ids that don't exist or a store we can't publish to.
  let collections: ProposedCollection[] = [];
  try {
    const loadedCols = await loadProjectSliceAdmin<ProposedCollection[]>(
      auth.admin,
      workspaceId,
      projectId,
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
    >(auth.admin, workspaceId, projectId, "content");
    if (loadedContent && typeof loadedContent === "object") {
      contentById = loadedContent;
    }
  } catch {
    // Content might not have been generated yet if pushed in Stage 5
  }

  const ledger: PushLedger =
    (await loadProjectSliceAdmin<PushLedger>(
      auth.admin,
      workspaceId,
      projectId,
      "push-ledger"
    ).catch(() => null)) ?? {};

  // Fetch active store integration and workspace prefix for this workspace
  const [integrationResult, wsResult] = await Promise.all([
    auth.admin
      .from("workspace_integrations")
      .select("provider, integration_name, base_url, config")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    auth.admin
      .from("workspaces")
      .select("collection_prefix")
      .eq("id", workspaceId)
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
    return Boolean(
      col?.storeHandle || col?.storeCollectionId || ledger[id]?.storeCollectionId
    );
  });
  const toPush = ids.filter((id) => !alreadyPushedIds.includes(id));

  const persistHandles = async () => {
    const entries = Object.entries(ledger).filter(([id]) => collectionById.has(id));
    if (entries.length === 0) return;
    const byId = new Map(entries);
    const nextCollections = collections.map((col) => {
      const update = byId.get(col.id);
      if (!update) return col;
      return {
        ...col,
        ...(update.handle ? { storeHandle: update.handle } : {}),
        ...(update.storeCollectionId ? { storeCollectionId: update.storeCollectionId } : {}),
      };
    });
    try {
      await saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "collections", nextCollections);
      const rest = Object.fromEntries(
        Object.entries(ledger).filter(([id]) => !byId.has(id))
      );
      await saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "push-ledger", rest);
    } catch (err) {
      // The ledger keeps the ids, so the next push still skips them.
      console.error("[push] Failed to persist store handles:", err);
    }
  };

  if (toPush.length === 0) {
    await persistHandles();
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

  // Refuse up front when the wallet can't cover the whole push, so a
  // merchant is never left with half a batch published.
  const amountUsd = collectionPushCostUsd(toPush.length);
  const wallet = await readWorkspaceWallet(auth.admin, workspaceId);
  if (wallet.balance < amountUsd) {
    return NextResponse.json(
      { error: "Not enough wallet balance" },
      { status: 402, headers: auth.headers }
    );
  }

  // Each collection is charged right before it is created and refunded if the
  // create fails, under keys unique to this push: a crash can cost at most
  // one collection, and a retry after a refund is charged again.
  const attemptId = crypto.randomUUID();
  let chargedUsd = 0;
  let refundedUsd = 0;
  let remaining: number | undefined = wallet.balance;
  const createdStoreResults: StoreResult[] = [];

  const refundOne = async (colId: string) => {
    const refunded = await refundMrWallet(auth.admin, {
      workspaceId,
      userId: auth.user.id,
      amountUsd: COLLECTION_PUSH_USD,
      description: "Push refund · collection failed to create",
      idempotencyKey: `collection_push:refund:${attemptId}:${colId}`,
      details: { projectId, collectionId: colId },
    });
    if (refunded.ok) {
      refundedUsd = roundUsd(refundedUsd + COLLECTION_PUSH_USD);
      remaining = refunded.remaining;
    } else {
      console.error("[push] Failed to refund a failed collection create:", refunded.message);
    }
  };

  let walletEmpty = false;
  for (let i = 0; i < toPush.length; i += 1) {
    const colId = toPush[i]!;
    const col = collectionById.get(colId);
    const colName = col?.name || colId;
    const storeTitle = `${prefix} - ${colName}`;
    if (walletEmpty) {
      createdStoreResults.push({
        id: colId,
        name: colName,
        storeTitle,
        success: false,
        error: "Wallet balance ran out",
      });
      continue;
    }
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const content = contentById[colId];

    const existing = await findOnStore(provider, integration, storeTitle);
    if (existing) {
      createdStoreResults.push({ id: colId, name: colName, storeTitle, ...existing, success: true });
      ledger[colId] = existing;
      await saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "push-ledger", ledger).catch(
        (err) => console.error("[push] Failed to record a pushed collection:", err)
      );
      continue;
    }

    const paid = await chargeMrWallet(auth.admin, {
      workspaceId,
      userId: auth.user.id,
      amountUsd: COLLECTION_PUSH_USD,
      description: `Push collection · ${colName}`,
      idempotencyKey: `collection_push:${attemptId}:${colId}`,
      details: { projectId, collectionId: colId },
    });
    if (!paid.ok) {
      walletEmpty = paid.reason === "insufficient_funds";
      createdStoreResults.push({
        id: colId,
        name: colName,
        storeTitle,
        success: false,
        error: walletEmpty ? "Wallet balance ran out" : "Could not charge the wallet",
      });
      continue;
    }
    chargedUsd = roundUsd(chargedUsd + COLLECTION_PUSH_USD);
    remaining = paid.remaining;

    let created: StoreResult;
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
        created = {
          id: colId,
          name: colName,
          storeTitle,
          handle: res.handle,
          storeCollectionId: res.id,
          success: true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Shopify creation error";
        console.error(`[push] Failed to create Shopify collection "${storeTitle}":`, msg);
        created = { id: colId, name: colName, storeTitle, success: false, error: msg };
      }
    } else {
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
        created = {
          id: colId,
          name: colName,
          storeTitle,
          handle: res.slug ? String(res.slug) : undefined,
          storeCollectionId: String(res.id),
          success: true,
        };
        if (wooProductIds.length > 0 && res.id) {
          try {
            await assignProductsToWooCategory({
              integration,
              categoryId: String(res.id),
              productIds: wooProductIds,
            });
          } catch (assignErr) {
            // A category with none of its products is not a delivered
            // collection: remove it and refund, so a retry starts clean
            // instead of leaving an empty copy on the store.
            const msg =
              assignErr instanceof Error ? assignErr.message : "Product assignment failed";
            console.error(
              `[push] WooCommerce category "${storeTitle}" created but product assignment failed:`,
              assignErr
            );
            const removed = await deleteWooCategories({
              integration,
              ids: [String(res.id)],
            }).catch(() => ({ deletedIds: [] as string[] }));
            if (removed.deletedIds.length === 0) {
              // Still on the store: keep its id so a retry does not create
              // (and charge for) a second copy.
              ledger[colId] = { storeCollectionId: String(res.id) };
              await saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "push-ledger", ledger).catch(
                () => undefined
              );
            }
            created = {
              id: colId,
              name: colName,
              storeTitle,
              success: false,
              error: `Category created without products: ${msg}`,
            };
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "WooCommerce creation error";
        console.error(`[push] Failed to create WooCommerce category "${storeTitle}":`, msg);
        created = { id: colId, name: colName, storeTitle, success: false, error: msg };
      }
    }

    createdStoreResults.push(created);
    if (created.success) {
      ledger[colId] = {
        ...(created.handle ? { handle: created.handle } : {}),
        ...(created.storeCollectionId ? { storeCollectionId: created.storeCollectionId } : {}),
      };
      await saveProjectSliceAdmin(auth.admin, workspaceId, projectId, "push-ledger", ledger).catch(
        (err) => console.error("[push] Failed to record a pushed collection:", err)
      );
    } else {
      await refundOne(colId);
    }
  }

  const successResults = createdStoreResults.filter((r) => r.success);
  const failedResults = createdStoreResults.filter((r) => !r.success);

  // The widget embed API matches on these exact handles, so without them it
  // cannot tell an AI collection page apart from a pre-existing store page.
  await persistHandles();

  return NextResponse.json(
    {
      ok: failedResults.length === 0,
      duplicate: false,
      chargedUsd: roundUsd(chargedUsd - refundedUsd),
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
