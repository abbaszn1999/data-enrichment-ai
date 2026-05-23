// Tool handler dispatch. One function per tool name from tool-catalog.
// Each handler:
//   - Receives a sanitized, Zod-validated args object
//   - Mutates `sheet` and `memory` in-place (working memory)
//   - Returns a structured output for the orchestrator to stream + trace

import type {
  AgentPlanV2,
  ApplyChangesInput,
  ApplyUpdate,
  ClientPredicate,
  ColumnProfileKey,
  IntegrationRecord,
  ShopifyServerFilter,
  SyncSheet,
  SyncSheetRow,
  SyncWorkingMemoryV2,
} from "@/lib/sync/core/types";
import type { ToolName } from "./tool-catalog";
import type { SyncBillingTracker, SyncMode } from "./ai-utils";
import {
  analyzeAttachments,
  answerQuestionAboutSheet,
  createRowWithAi,
  generateSheetFilterFn,
  researchWithWeb,
  searchImagesForRows,
  writeSheetColumnWithAi,
  type IntegrationContext,
  type SyncInlineAttachment,
} from "./ai-helpers";
import {
  fetchShopifyProductsPage,
  fetchShopifyProductsByIds,
  fetchShopifyProductsBulk,
} from "@/lib/sync/providers/shopify/fetch-products";
import { applyClientPredicates } from "@/lib/sync/providers/shopify/filter-builder";
import {
  assignProductsToCollection,
  createShopifyCollection,
  deleteShopifyCollection,
  fetchShopifyCollections,
  resolveCollectionByName,
  applyShopifyCollectionUpdates,
} from "@/lib/sync/providers/shopify/collections";
import { applyShopifyChanges } from "@/lib/sync/providers/shopify/apply";
import { createWooCommerceCategory, fetchWooCommerceCategories } from "@/lib/sync/providers/woocommerce/categories";
import { getProvider } from "@/lib/sync/core/registry";

export type HandlerContext = {
  integration: IntegrationRecord | null;
  integrationContext: IntegrationContext;
  sheet: SyncSheet | null;
  originalSheet: SyncSheet | null;
  mode: SyncMode;
  plan: AgentPlanV2;
  workingMemory: SyncWorkingMemoryV2;
  attachments: SyncInlineAttachment[];
  billingTracker?: SyncBillingTracker;
  onProgress?: (message: string) => void;
  /** Live, mid-tool progress callback. Long-running handlers (column writes,
   *  image search) call this every batch with partial values so the UI can
   *  render the new cells immediately instead of waiting for tool_result. */
  onToolProgress?: (update: {
    column?: string;
    processed: number;
    total: number;
    partialValues?: Array<{ rowIndex: number; column: string; value: string }>;
    failedCount?: number;
  }) => void;
  /** AbortSignal — surfaced by the caller (route handler) so the user can
   *  cancel a long-running write/search mid-flight. Handlers should check
   *  `signal.aborted` between batches and bail gracefully. */
  signal?: AbortSignal;
  /** Supabase admin client — for handlers that need to touch DB-side state
   * (e.g. webhook registrations, bulk-op rows). */
  admin?: import("@supabase/supabase-js").SupabaseClient;
  /** Workspace id — paired with `admin` for tenancy-scoped lookups/writes. */
  workspaceId?: string;
};

export type HandlerResult = {
  assistantMessage?: string;
  sheet?: SyncSheet | null;
  rowsAffected?: number;
  columnsAffected?: string[];
  toolsExecuted?: string[];
  warnings?: string[];
  userErrorCount?: number;
  userErrorCodes?: string[];
  /** Tool output payload for tracing/UI. */
  output?: unknown;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireIntegration(ctx: HandlerContext): IntegrationRecord {
  if (!ctx.integration) throw new Error("No connected integration.");
  return ctx.integration;
}

/**
 * Decide which rows a tool should act on.
 *
 * Order of preference:
 *   1. Explicit `rowIndexes` from the tool args — the model said which rows.
 *   2. `workingMemory.lastTargetedRowIndexes` — the rows the previous turn
 *      touched (anaphoric "them"/"البقية"/"ضع لهم").
 *   3. `workingMemory.lastCreatedRowIndexes` — rows just appended by
 *      `sync_row_append`, so "give it a description" works on the new row.
 *
 * The model always sees the current `lastTargetedRowIndexes` value in the
 * memory snapshot inside the system prompt, so it can also choose to pass
 * them explicitly. There is no boolean flag any more — passing rowIndexes
 * means "use these"; omitting them means "fall back to memory".
 */
function resolveRowIndexes(ctx: HandlerContext, fromArgs?: number[]): number[] | undefined {
  if (Array.isArray(fromArgs) && fromArgs.length > 0) return fromArgs;
  const remembered = ctx.workingMemory.lastTargetedRowIndexes;
  if (remembered.length > 0) return remembered;
  const created = ctx.workingMemory.lastCreatedRowIndexes;
  if (created.length > 0) return created;
  return undefined;
}

function applyScopeCap(indexes: number[] | undefined, cap: number, rowsLen: number): number[] {
  const base = indexes ?? Array.from({ length: rowsLen }, (_, i) => i);
  return cap > 0 && cap < base.length ? base.slice(0, cap) : base;
}

/**
 * Resolve the effective scope cap for a write tool. The plan-level scopeCap
 * (set by the planner from the user's intent + class clamps) is authoritative;
 * tool-args scopeCap is only used when it's strictly tighter. This prevents the
 * Zod default (`3`) from silently overriding e.g. "first 2 products" → 2.
 */
function effectiveScopeCap(ctx: HandlerContext, argsCap: number | undefined): number {
  const planCap = typeof ctx.plan?.scopeCap === "number" ? ctx.plan.scopeCap : 0;
  const a = typeof argsCap === "number" && argsCap > 0 ? argsCap : 0;
  if (planCap > 0 && a > 0) return Math.min(planCap, a);
  return planCap > 0 ? planCap : a;
}

function columnsFromRow(row: Record<string, unknown> | null | undefined): string[] {
  if (!row) return [];
  return Object.keys(row);
}

/**
 * Pick the tab set the UI should expose after a products-entity load.
 * Prefer the planner's `relevantProfiles` hint; otherwise derive a sensible
 * default from the chosen columnProfile so the bar is never cluttered with
 * every profile at once.
 */
function pickProductsRelevantProfiles(
  ctx: HandlerContext,
  columnProfile: ColumnProfileKey | undefined
): ColumnProfileKey[] {
  const planHint = ctx.plan?.relevantProfiles;
  if (planHint && planHint.length > 0) {
    // Drop "collections" — that's a different entity's tab.
    const filtered = planHint.filter((p) => p !== "collections");
    if (filtered.length > 0) return filtered;
  }
  const profile = (columnProfile ?? "core") as ColumnProfileKey;
  return profilesAroundFocus(profile);
}

/**
 * Map a sheet column → the most relevant column profile (tab). Used by write
 * tools so the UI auto-switches to the tab that contains the column the agent
 * just modified ("alt text" → Imagery tab, "seo_title" → SEO tab, …).
 */
function profileForColumn(column: string): ColumnProfileKey {
  switch (column) {
    case "featured_image":
    case "featured_image_alt_text":
    case "image_count":
      return "imagery";
    case "seo_title":
    case "seo_description":
    case "handle":
      return "seo";
    case "body_html":
      return "content";
    case "price":
    case "compare_at_price":
      return "pricing";
    case "category":
    case "product_type":
    case "tags":
    case "vendor":
      return "taxonomy";
    case "inventory_total":
    case "primary_sku":
    case "barcode":
    case "variant_count":
      return "inventory";
    case "status":
    case "published_at":
      return "publishing";
    // Collection-only columns — route to the collections tab so the UI
    // auto-switches after write operations on a collections sheet.
    case "description":
    case "image":
    case "image_alt_text":
    case "sort_order":
    case "published":
    case "products_count":
      return "collections";
    default:
      return "core";
  }
}

/**
 * Given a focus profile, build the tab strip the UI should expose: the focus
 * tab first, then "core" and "all" as escape hatches. Used by both load
 * handlers and write handlers so that the moment a write tool runs the user
 * sees the tab that contains the column that just changed.
 */
function profilesAroundFocus(focus: ColumnProfileKey): ColumnProfileKey[] {
  const base: ColumnProfileKey[] =
    focus === "core" ? ["core", "all"] : [focus, "core", "all"];
  return Array.from(new Set(base));
}

// ─── Individual handlers ─────────────────────────────────────────────────────

async function handleProductsLoad(
  args: {
    serverFilter?: ShopifyServerFilter;
    clientPredicates?: ClientPredicate[];
    cursor?: string;
    limit?: number;
    mode?: "page" | "bulk_query" | "by_ids";
    ids?: string[];
    columnProfile?: ColumnProfileKey;
  },
  ctx: HandlerContext
): Promise<HandlerResult> {
  const integration = requireIntegration(ctx);
  const serverFilter = args.serverFilter ?? ctx.plan.serverFilter ?? null;
  const predicates = args.clientPredicates ?? ctx.plan.clientPredicates ?? null;

  if (integration.provider === "woocommerce") {
    const provider = getProvider("woocommerce");
    const loaded = await provider.fetchProductsSheet(integration, {
      limit: args.limit ?? 0,
    });
    const matchingIndexes = applyClientPredicates(loaded.rows, predicates);
    const sheet =
      matchingIndexes.length === loaded.rows.length
        ? loaded
        : {
            ...loaded,
            rows: matchingIndexes.map((i) => loaded.rows[i]).filter(Boolean),
          };
    ctx.sheet = sheet;
    ctx.originalSheet = sheet;
    ctx.workingMemory.lastTargetedRowIndexes = sheet.rows.map((_, i) => i);
    ctx.workingMemory.lastTargetedProductIds = sheet.rows
      .map((r) => String(r.id ?? ""))
      .filter(Boolean);
    ctx.workingMemory.lastActionType = "load_sheet";
    ctx.workingMemory.lastColumnProfile = args.columnProfile ?? "core";
    ctx.workingMemory.lastEntity = "products";
    ctx.workingMemory.lastRelevantProfiles = pickProductsRelevantProfiles(ctx, args.columnProfile);
    ctx.workingMemory.totalMatchCount = sheet.rows.length;
    ctx.workingMemory.remainingCount = null;
    return {
      sheet,
      rowsAffected: sheet.rows.length,
      output: { rowCount: sheet.rows.length, mode: "provider_fetch", provider: "woocommerce" },
    };
  }

  // Mode inference — the planner is instructed to OMIT `mode` whenever the
  // user wants the full match set ("all/كل/جميع", any unknown-size load, or any
  // intent that needs client-side predicates). In those cases we default to
  // `bulk_query` so the agent fetches every matching product in one shot via
  // the Shopify Bulk Operations API instead of just the first 50 from a page
  // fetch. We only fall back to `page` when the planner explicitly asked for
  // it (mode="page") or signaled a small preview by passing `limit`/`cursor`.
  let mode: "page" | "bulk_query" | "by_ids";
  if (args.mode) {
    mode = args.mode;
  } else if (predicates && predicates.length > 0) {
    mode = "bulk_query";
    ctx.onProgress?.(
      "Detected client-side filter — switching to bulk query so all matches are returned."
    );
  } else if (typeof args.limit === "number" || typeof args.cursor === "string") {
    // Explicit pagination signal from the planner ("first N", "load more").
    mode = "page";
  } else {
    mode = "bulk_query";
    ctx.onProgress?.(
      "Loading all products via Shopify Bulk Operations…"
    );
  }

  if (mode === "by_ids") {
    const ids =
      args.ids && args.ids.length > 0
        ? args.ids
        : ctx.workingMemory.lastTargetedProductIds;
    if (!ids || ids.length === 0) {
      return {
        assistantMessage: "No product IDs to load.",
        sheet: null,
      };
    }
    const sheet = await fetchShopifyProductsByIds({ integration, ids });
    ctx.sheet = sheet;
    ctx.originalSheet = sheet;
    ctx.workingMemory.lastTargetedProductIds = ids;
    ctx.workingMemory.lastActionType = "load_sheet";
    ctx.workingMemory.lastColumnProfile = args.columnProfile ?? "core";
    ctx.workingMemory.lastEntity = "products";
    ctx.workingMemory.lastRelevantProfiles = pickProductsRelevantProfiles(ctx, args.columnProfile);
    return {
      sheet,
      rowsAffected: sheet.rows.length,
      output: { rowCount: sheet.rows.length, mode: "by_ids" },
    };
  }

  if (mode === "bulk_query") {
    // Ensure BULK_OPERATIONS_FINISH webhook is registered before the bulk op
    // starts — otherwise we'd never get notified of completion. Idempotent.
    if (ctx.admin && ctx.workspaceId) {
      try {
        const { ensureBulkFinishWebhook } = await import(
          "@/lib/sync/providers/shopify/webhooks"
        );
        await ensureBulkFinishWebhook({
          admin: ctx.admin,
          workspaceId: ctx.workspaceId,
          integration,
        });
      } catch (err) {
        // Non-fatal — webhook is for completion notification convenience only.
        ctx.onProgress?.(
          `Webhook registration warning: ${(err as Error).message}`
        );
      }
    }
    ctx.onProgress?.("Submitting Shopify bulk query…");
    const bulkResult = await fetchShopifyProductsBulk({
      integration,
      serverFilter,
      clientPredicates: predicates,
    });
    const bulkOperationId = bulkResult.bulkOperationId;
    let sheet = bulkResult.sheet;
    const totalMatched = sheet.rows.length;

    // Respect an explicit `limit` even on bulk_query. We still bulk-fetch so
    // client-side predicates (missing_image, no_collections, …) get applied to
    // the full catalog, but we slice the matching set down to N rows so
    // "اعرض 10 منتجات بدون صور" returns 10 — not the full match set.
    if (typeof args.limit === "number" && args.limit > 0 && sheet.rows.length > args.limit) {
      sheet = {
        ...sheet,
        rows: sheet.rows.slice(0, args.limit),
      };
      ctx.onProgress?.(
        `Found ${totalMatched} matches; showing the first ${args.limit} as requested.`
      );
    }

    // Persist a sync_bulk_operations row so the webhook handler can match it
    // by shopify_bulk_id when the FINISH event arrives.
    if (ctx.admin && ctx.workspaceId && bulkOperationId) {
      await ctx.admin
        .from("sync_bulk_operations")
        .upsert(
          {
            workspace_id: ctx.workspaceId,
            kind: "query",
            shopify_bulk_id: bulkOperationId,
            status: "running",
            metadata: { serverFilter, clientPredicates: predicates },
          },
          { onConflict: "shopify_bulk_id" }
        );
    }
    ctx.sheet = sheet;
    ctx.originalSheet = sheet;
    ctx.workingMemory.lastServerFilter = serverFilter;
    ctx.workingMemory.lastClientPredicates = predicates;
    ctx.workingMemory.lastBulkOperationId = bulkOperationId;
    ctx.workingMemory.lastActionType = "load_sheet";
    ctx.workingMemory.totalMatchCount = totalMatched;
    ctx.workingMemory.remainingCount = Math.max(0, totalMatched - sheet.rows.length);
    ctx.workingMemory.lastColumnProfile = args.columnProfile ?? "core";
    ctx.workingMemory.lastEntity = "products";
    ctx.workingMemory.lastRelevantProfiles = pickProductsRelevantProfiles(ctx, args.columnProfile);
    return {
      sheet,
      rowsAffected: sheet.rows.length,
      output: {
        rowCount: sheet.rows.length,
        totalMatched,
        mode: "bulk_query",
        bulkOperationId,
        capped: sheet.rows.length < totalMatched,
      },
    };
  }

  const cursor = args.cursor ?? ctx.workingMemory.lastCursor ?? undefined;
  const isContinuation = !!cursor;
  const { sheet: pageSheet, endCursor, hasNextPage } = await fetchShopifyProductsPage({
    integration,
    serverFilter,
    clientPredicates: predicates,
    cursor,
    limit: args.limit ?? 50,
  });

  // When continuing from a saved cursor, append rows to the existing sheet
  // instead of replacing it — this preserves all previously loaded products
  // so the user sees the full accumulated set, not just the latest page.
  // De-duplicate by `id` to be safe if the cursor overlaps.
  let nextSheet = pageSheet;
  if (isContinuation && ctx.sheet && Array.isArray(ctx.sheet.rows)) {
    const existing = ctx.sheet.rows;
    const seen = new Set(
      existing
        .map((r) => (r as Record<string, unknown>).id)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    );
    const fresh = pageSheet.rows.filter((r) => {
      const id = (r as Record<string, unknown>).id;
      return typeof id === "string" ? !seen.has(id) : true;
    });
    nextSheet = {
      title: ctx.sheet.title || pageSheet.title,
      columns: ctx.sheet.columns?.length ? ctx.sheet.columns : pageSheet.columns,
      rows: [...existing, ...fresh],
    };
    ctx.onProgress?.(
      `Appended ${fresh.length} more products (total: ${nextSheet.rows.length}).`
    );
  }

  ctx.sheet = nextSheet;
  ctx.originalSheet = nextSheet;
  ctx.workingMemory.lastServerFilter = serverFilter;
  ctx.workingMemory.lastClientPredicates = predicates;
  ctx.workingMemory.lastCursor = endCursor;
  ctx.workingMemory.lastActionType = "load_sheet";
  ctx.workingMemory.lastColumnProfile = args.columnProfile ?? "core";
  ctx.workingMemory.lastEntity = "products";
  ctx.workingMemory.lastRelevantProfiles = pickProductsRelevantProfiles(ctx, args.columnProfile);
  ctx.workingMemory.remainingCount = hasNextPage ? 1 : 0;
  return {
    sheet: nextSheet,
    rowsAffected: nextSheet.rows.length,
    output: {
      rowCount: nextSheet.rows.length,
      pageRowCount: pageSheet.rows.length,
      hasNextPage,
      endCursor,
      appended: isContinuation,
    },
  };
}

async function handleProductsFilterClient(
  args: { predicates: ClientPredicate[]; rowIndexes?: number[] },
  ctx: HandlerContext
): Promise<HandlerResult> {
  if (!ctx.sheet) return { assistantMessage: "No sheet loaded to filter." };

  const rowsToCheck = args.rowIndexes
    ? args.rowIndexes.map((i) => ctx.sheet!.rows[i]).filter(Boolean)
    : ctx.sheet.rows;
  const localIndexes = applyClientPredicates(rowsToCheck as SyncSheetRow[], args.predicates);

  // Map back to global indexes
  const globalIndexes = args.rowIndexes
    ? localIndexes.map((i) => args.rowIndexes![i])
    : localIndexes;

  ctx.workingMemory.lastTargetedRowIndexes = globalIndexes;
  ctx.workingMemory.lastFilterDescription = args.predicates
    .map((p) => (typeof p === "object" && "kind" in p ? (p as { kind: string }).kind : String(p)))
    .join(", ") || null;
  ctx.workingMemory.lastActionType = "target_rows";
  return {
    rowsAffected: globalIndexes.length,
    output: { matchedRowIndexes: globalIndexes },
  };
}

async function handleCollectionsLoad(
  args: { query?: string; limit?: number },
  ctx: HandlerContext
): Promise<HandlerResult> {
  const integration = requireIntegration(ctx);
  const sheet =
    integration.provider === "woocommerce"
      ? await fetchWooCommerceCategories({
          integration,
          query: args.query,
          limit: args.limit ?? 50,
        })
      : await fetchShopifyCollections({
          integration,
          query: args.query,
          limit: args.limit ?? 50,
        });
  ctx.sheet = sheet;
  ctx.originalSheet = sheet;
  ctx.workingMemory.lastActionType = "load_sheet";
  ctx.workingMemory.lastColumnProfile = "collections";
  ctx.workingMemory.lastEntity = "collections";
  ctx.workingMemory.lastRelevantProfiles = ["collections"];
  // Entity switch — clear stale product-scoped memory so follow-up anaphoric
  // references don't accidentally target product rows from a previous turn.
  ctx.workingMemory.lastTargetedRowIndexes = [];
  ctx.workingMemory.lastTargetedProductIds = [];
  ctx.workingMemory.lastCursor = null;
  return { sheet, rowsAffected: sheet.rows.length, output: { count: sheet.rows.length } };
}

async function handleCollectionsResolve(
  args: { name: string },
  ctx: HandlerContext
): Promise<HandlerResult> {
  const integration = requireIntegration(ctx);
  const resolved = await resolveCollectionByName({ integration, name: args.name });
  if (resolved) {
    ctx.workingMemory.collectionsByName[args.name.toLowerCase()] = {
      id: resolved.id,
      handle: resolved.handle,
    };
  }
  return {
    assistantMessage: resolved
      ? `Resolved "${args.name}" → collection ${resolved.handle}`
      : `No collection matches "${args.name}".`,
    output: resolved,
  };
}

async function handleCollectionsCreate(
  args: {
    title: string;
    type: "manual" | "smart";
    descriptionHtml?: string;
    slug?: string;
    parent?: number;
    imageId?: number;
    productIds?: string[];
    ruleSet?: {
      appliedDisjunctively: boolean;
      rules: Array<{
        column: string;
        relation: string;
        condition: string;
        conditionObjectId?: string;
      }>;
    };
  },
  ctx: HandlerContext
): Promise<HandlerResult> {
  const integration = requireIntegration(ctx);
  if (integration.provider === "woocommerce") {
    const created = await createWooCommerceCategory({
      integration,
      category: {
        name: args.title,
        slug: args.slug,
        parent: args.parent,
        description: args.descriptionHtml,
        imageId: args.imageId,
      },
    });
    const name = String(created.name ?? args.title);
    const slug = String(created.slug ?? "");
    ctx.workingMemory.collectionsByName[name.toLowerCase()] = {
      id: String(created.id ?? ""),
      handle: slug,
    };

    let appendedRow: SyncSheetRow | null = null;
    if (ctx.sheet && ctx.workingMemory.lastEntity === "collections") {
      appendedRow = {};
      for (const col of ctx.sheet.columns) appendedRow[col] = created[col] ?? "";
      ctx.sheet.rows = [...ctx.sheet.rows, appendedRow];
      const newIndex = ctx.sheet.rows.length - 1;
      ctx.workingMemory.lastCreatedRowIndexes = [newIndex];
      ctx.workingMemory.lastTargetedRowIndexes = [newIndex];
      ctx.workingMemory.lastEntity = "collections";
      ctx.workingMemory.lastColumnProfile = "collections";
      ctx.workingMemory.lastRelevantProfiles = ["collections"];
    }

    return {
      assistantMessage: `Created WooCommerce category "${name}"${slug ? ` (${slug})` : ""}.`,
      rowsAffected: appendedRow ? 1 : 0,
      output: { ...created, appendedRow: !!appendedRow },
    };
  }

  const created = await createShopifyCollection({
    integration,
    input: {
      title: args.title,
      type: args.type,
      descriptionHtml: args.descriptionHtml,
      productIds: args.productIds,
      ruleSet: args.ruleSet as never,
    },
  });
  ctx.workingMemory.collectionsByName[created.title.toLowerCase()] = {
    id: created.id,
    handle: created.handle,
  };

  // Reflect the new collection in the current sheet so the UI shows it
  // without requiring a manual reload. Only append if the current sheet
  // looks like a collections view (has an `id` column and no products-only
  // markers) — otherwise we'd pollute a products sheet with a collection row.
  let appendedRow: SyncSheetRow | null = null;
  if (ctx.sheet && ctx.sheet.columns.includes("id") && ctx.sheet.columns.includes("handle")) {
    const looksLikeCollections =
      (ctx.sheet.title ?? "").toLowerCase().includes("collection") ||
      ctx.workingMemory.lastEntity === "collections" ||
      ctx.sheet.columns.includes("products_count");
    if (looksLikeCollections) {
      appendedRow = {};
      for (const col of ctx.sheet.columns) appendedRow[col] = "";
      appendedRow.id = created.id;
      appendedRow.title = created.title;
      appendedRow.handle = created.handle;
      if ("description" in appendedRow) appendedRow.description = args.descriptionHtml ?? "";
      if ("products_count" in appendedRow) appendedRow.products_count = created.assignedCount ?? 0;
      if ("type" in appendedRow) appendedRow.type = args.type;
      ctx.sheet.rows = [...ctx.sheet.rows, appendedRow];
      const newIndex = ctx.sheet.rows.length - 1;
      ctx.workingMemory.lastCreatedRowIndexes = [newIndex];
      ctx.workingMemory.lastTargetedRowIndexes = [newIndex];
      ctx.workingMemory.lastEntity = "collections";
    }
  }

  const suffix = created.assignedCount
    ? ` with ${created.assignedCount} product${created.assignedCount === 1 ? "" : "s"}`
    : "";

  // Build a direct Shopify admin URL for the new collection so the user can
  // click through and verify it really landed in the store — this short-
  // circuits any "I clicked sync but nothing shows up in Shopify" confusion
  // (collections are pushed by this tool directly, not via the pending-
  // changes Sync button).
  const adminUrl = buildShopifyCollectionAdminUrl(integration.base_url, created.id);
  const verifyLine = adminUrl
    ? `\nView in Shopify admin: ${adminUrl}`
    : "";

  return {
    assistantMessage:
      `Created ${args.type} collection "${created.title}" (${created.handle})${suffix}. ` +
      `It has been pushed to Shopify already — the "Sync" button is for product edits, not collections.${verifyLine}`,
    rowsAffected: appendedRow ? 1 : 0,
    output: { ...created, appendedRow: !!appendedRow, adminUrl },
  };
}

/**
 * Build the Shopify admin URL for a collection GID. Returns null if we can't
 * derive the shop slug from the integration's base URL. Example:
 *   base_url = https://autommerce.myshopify.com
 *   gid      = gid://shopify/Collection/307382714503
 *   →        https://admin.shopify.com/store/autommerce/collections/307382714503
 */
function buildShopifyCollectionAdminUrl(
  baseUrl: string | null | undefined,
  collectionGid: string
): string | null {
  if (!baseUrl) return null;
  const match = /https?:\/\/([^./]+)\.myshopify\.com/i.exec(baseUrl);
  const shopSlug = match?.[1];
  if (!shopSlug) return null;
  const idMatch = /\/Collection\/(\d+)/.exec(collectionGid);
  const numericId = idMatch?.[1];
  if (!numericId) return null;
  return `https://admin.shopify.com/store/${shopSlug}/collections/${numericId}`;
}

async function handleCollectionsAssign(
  args: { collectionId: string; rowIndexes: number[] },
  ctx: HandlerContext
): Promise<HandlerResult> {
  const integration = requireIntegration(ctx);
  if (!ctx.sheet) throw new Error("No sheet loaded.");
  const productIds = args.rowIndexes
    .map((i) => ctx.sheet!.rows[i])
    .map((row) => String(row?.id ?? "").trim())
    .filter(Boolean);
  if (productIds.length === 0) return { assistantMessage: "No valid product IDs selected." };
  const { assignedCount, newTotal } = await assignProductsToCollection({
    integration,
    collectionId: args.collectionId,
    productIds,
  });
  return {
    rowsAffected: assignedCount,
    assistantMessage: `Assigned ${assignedCount} products${newTotal != null ? ` (collection now has ${newTotal})` : ""}.`,
    output: { assignedCount, newTotal },
  };
}

async function handleCollectionsDelete(
  args: { collectionIds?: string[]; rowIndexes?: number[] },
  ctx: HandlerContext
): Promise<HandlerResult> {
  const integration = requireIntegration(ctx);

  // Resolve GIDs to delete: explicit `collectionIds` win; otherwise look up
  // by row index in the current (collections) sheet's `id` column.
  const ids = new Set<string>();
  if (args.collectionIds) {
    for (const id of args.collectionIds) {
      const trimmed = String(id ?? "").trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  if (args.rowIndexes && ctx.sheet) {
    for (const i of args.rowIndexes) {
      const row = ctx.sheet.rows[i];
      const id = String(row?.id ?? "").trim();
      if (id) ids.add(id);
    }
  }

  if (ids.size === 0) {
    return {
      assistantMessage:
        "No collection IDs to delete. Pass either `collectionIds` (GIDs) or `rowIndexes` into the current collections sheet.",
    };
  }

  // Validate all GIDs upfront so a typo doesn't silently delete a different
  // resource type.
  for (const id of ids) {
    if (!id.startsWith("gid://shopify/Collection/")) {
      return {
        assistantMessage: `Invalid collection GID: "${id}". Must start with gid://shopify/Collection/`,
      };
    }
  }

  const deleted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of ids) {
    try {
      const { deletedId } = await deleteShopifyCollection({ integration, collectionId: id });
      deleted.push(deletedId);
    } catch (err) {
      failed.push({ id, error: (err as Error).message || "delete failed" });
    }
  }

  // Drop the deleted rows from the current sheet so the UI reflects reality
  // without a manual reload. Match by `id` column.
  let droppedFromSheet = 0;
  if (ctx.sheet && deleted.length > 0) {
    const deletedSet = new Set(deleted);
    const before = ctx.sheet.rows.length;
    ctx.sheet.rows = ctx.sheet.rows.filter(
      (row) => !deletedSet.has(String(row?.id ?? "").trim())
    );
    droppedFromSheet = before - ctx.sheet.rows.length;
  }

  // Forget any in-memory references to the deleted collections so a follow-up
  // resolve call doesn't hand back a dead GID.
  for (const [name, info] of Object.entries(ctx.workingMemory.collectionsByName)) {
    if (deleted.includes(info.id)) {
      delete ctx.workingMemory.collectionsByName[name];
    }
  }

  const warnings = failed.map((f) => `${f.id}: ${f.error}`);
  const failedSuffix = failed.length > 0 ? ` (${failed.length} failed)` : "";
  return {
    rowsAffected: droppedFromSheet,
    assistantMessage:
      deleted.length > 0
        ? `Permanently deleted ${deleted.length} collection${deleted.length === 1 ? "" : "s"} from Shopify${failedSuffix}.`
        : `No collections were deleted.${failedSuffix}`,
    warnings,
    output: { deletedIds: deleted, failed, droppedFromSheet },
  };
}

async function handleColumnsWriteWithAi(
  args: {
    targetColumn: string;
    instruction: string;
    overwrite: boolean;
    rowIndexes?: number[];
    scopeCap: number;
  },
  ctx: HandlerContext
): Promise<HandlerResult> {
  if (!ctx.sheet) throw new Error("No sheet loaded.");
  const resolved = resolveRowIndexes(ctx, args.rowIndexes);
  const cap = effectiveScopeCap(ctx, args.scopeCap);
  const targetIndexes = applyScopeCap(resolved, cap, ctx.sheet.rows.length);

  // Make sure the target column exists BEFORE the first batch lands so the
  // streaming chunks can write into it without the UI seeing a column-shape
  // mismatch.
  if (!ctx.sheet.columns.includes(args.targetColumn)) {
    ctx.sheet.columns = [...ctx.sheet.columns, args.targetColumn];
  }

  const {
    values,
    totalEligible,
    processedCount,
    batchWarnings,
    failedRowIndexes,
  } = await writeSheetColumnWithAi({
    rows: ctx.sheet.rows,
    mode: ctx.mode,
    instruction: args.instruction,
    integration: ctx.integrationContext,
    targetColumn: args.targetColumn,
    existingColumns: ctx.sheet.columns,
    rowIndexes: targetIndexes,
    billingTracker: ctx.billingTracker,
    signal: ctx.signal,
    // Stream each batch into the live sheet AND forward to the agent loop so
    // the UI can render partial cells in real time.
    onChunk: (chunk) => {
      if (!ctx.sheet) return;
      const partial: Array<{ rowIndex: number; column: string; value: string }> = [];
      for (const { rowIndex, value } of chunk.values) {
        if (rowIndex < 0 || rowIndex >= ctx.sheet.rows.length) continue;
        const existing = ctx.sheet.rows[rowIndex][args.targetColumn];
        if (!args.overwrite && existing !== undefined && String(existing ?? "").trim()) {
          continue;
        }
        ctx.sheet.rows[rowIndex][args.targetColumn] = value;
        partial.push({ rowIndex, column: args.targetColumn, value });
      }
      ctx.onToolProgress?.({
        column: args.targetColumn,
        processed: chunk.processedCount,
        total: chunk.totalCount,
        partialValues: partial,
        failedCount: chunk.failedCount,
      });
    },
  });

  // Belt-and-suspenders: in case any value from the final batch wasn't applied
  // by the onChunk path (e.g. callback threw), do one final reconciliation
  // pass. With the streaming write above this is usually a no-op.
  for (const { rowIndex, value } of values) {
    if (rowIndex < 0 || rowIndex >= ctx.sheet.rows.length) continue;
    const existing = ctx.sheet.rows[rowIndex][args.targetColumn];
    if (!args.overwrite && existing !== undefined && String(existing ?? "").trim()) continue;
    ctx.sheet.rows[rowIndex][args.targetColumn] = value;
  }

  ctx.workingMemory.lastTouchedColumns = [
    ...new Set([...(ctx.workingMemory.lastTouchedColumns ?? []), args.targetColumn]),
  ];
  ctx.workingMemory.lastActionType = "write_column";
  ctx.workingMemory.lastTargetedRowIndexes = targetIndexes;
  // Surface the most relevant tab so the UI auto-switches to the column the
  // user just asked us to write (e.g. seo_title → SEO tab).
  {
    const focus = profileForColumn(args.targetColumn);
    ctx.workingMemory.lastEntity = ctx.workingMemory.lastEntity ?? "products";
    ctx.workingMemory.lastColumnProfile = focus;
    ctx.workingMemory.lastRelevantProfiles = profilesAroundFocus(focus);
  }

  // Append a single summary warning for failed rows so the agent (and the
  // user) can decide whether to retry just those.
  const summaryWarnings = [...batchWarnings];
  if (failedRowIndexes.length > 0) {
    summaryWarnings.push(
      `${failedRowIndexes.length} row(s) failed: ${failedRowIndexes.slice(0, 10).join(", ")}${
        failedRowIndexes.length > 10 ? ", …" : ""
      }`
    );
  }

  return {
    rowsAffected: values.length,
    columnsAffected: [args.targetColumn],
    warnings: summaryWarnings,
    output: {
      totalEligible,
      processedCount,
      values: values.length,
      failedRowIndexes,
    },
  };
}

async function handleImagesSearch(
  args: {
    targetColumn: string;
    instruction: string;
    overwrite: boolean;
    rowIndexes?: number[];
    scopeCap: number;
  },
  ctx: HandlerContext
): Promise<HandlerResult> {
  if (!ctx.sheet) throw new Error("No sheet loaded.");
  const resolved = resolveRowIndexes(ctx, args.rowIndexes);
  const cap = effectiveScopeCap(ctx, args.scopeCap);
  const targetIndexes = applyScopeCap(resolved, cap, ctx.sheet.rows.length);

  // Ensure the image column exists up-front so streamed chunks can write into
  // it without the UI seeing a column-shape mismatch.
  if (!ctx.sheet.columns.includes(args.targetColumn)) {
    ctx.sheet.columns = [...ctx.sheet.columns, args.targetColumn];
  }

  const results = await searchImagesForRows({
    rows: ctx.sheet.rows,
    rowIndexes: targetIndexes,
    instruction: args.instruction,
    targetColumn: args.targetColumn,
    signal: ctx.signal,
    onChunk: (chunk) => {
      if (!ctx.sheet) return;
      const partial: Array<{ rowIndex: number; column: string; value: string }> = [];
      for (const { rowIndex, imageUrl } of chunk.values) {
        if (rowIndex < 0 || rowIndex >= ctx.sheet.rows.length) continue;
        const existing = ctx.sheet.rows[rowIndex][args.targetColumn];
        if (!args.overwrite && existing !== undefined && String(existing ?? "").trim()) {
          continue;
        }
        ctx.sheet.rows[rowIndex][args.targetColumn] = imageUrl;
        partial.push({ rowIndex, column: args.targetColumn, value: imageUrl });
      }
      ctx.onToolProgress?.({
        column: args.targetColumn,
        processed: chunk.processedCount,
        total: chunk.totalCount,
        partialValues: partial,
        failedCount: chunk.failedCount,
      });
    },
  });

  // Reconciliation pass — same defensive write as the column-write handler.
  for (const { rowIndex, imageUrl } of results) {
    const existing = ctx.sheet.rows[rowIndex][args.targetColumn];
    if (!args.overwrite && existing !== undefined && String(existing ?? "").trim()) continue;
    ctx.sheet.rows[rowIndex][args.targetColumn] = imageUrl;
  }

  ctx.workingMemory.lastTouchedColumns = [
    ...new Set([...(ctx.workingMemory.lastTouchedColumns ?? []), args.targetColumn]),
  ];
  ctx.workingMemory.lastActionType = "write_column";
  ctx.workingMemory.lastTargetedRowIndexes = targetIndexes;
  // Image writes always belong to the Imagery tab — surface it so the user
  // immediately sees the column that was just populated.
  {
    const focus = profileForColumn(args.targetColumn);
    ctx.workingMemory.lastEntity = ctx.workingMemory.lastEntity ?? "products";
    ctx.workingMemory.lastColumnProfile = focus;
    ctx.workingMemory.lastRelevantProfiles = profilesAroundFocus(focus);
  }

  return {
    rowsAffected: results.length,
    columnsAffected: [args.targetColumn],
    output: { imagesFound: results.length, targetRows: targetIndexes.length },
  };
}

async function handleRowAppend(
  args: { instruction: string },
  ctx: HandlerContext
): Promise<HandlerResult> {
  if (!ctx.sheet) {
    ctx.sheet = {
      title: ctx.integrationContext?.integration_name
        ? `Products · ${ctx.integrationContext.integration_name}`
        : "Products",
      columns: [],
      rows: [],
    };
    ctx.originalSheet = ctx.sheet;
  }

  const row = await createRowWithAi({
    mode: ctx.mode,
    instruction: args.instruction,
    integration: ctx.integrationContext,
    existingColumns: ctx.sheet.columns,
    sheet: ctx.sheet,
    billingTracker: ctx.billingTracker,
  });

  const newIdx = ctx.sheet.rows.length;
  // Extend columns for any new keys in the row
  for (const k of Object.keys(row)) {
    if (!ctx.sheet.columns.includes(k)) ctx.sheet.columns.push(k);
  }
  ctx.sheet.rows.push(row);

  ctx.workingMemory.lastCreatedRowIndexes = [
    ...ctx.workingMemory.lastCreatedRowIndexes,
    newIdx,
  ];
  ctx.workingMemory.lastActionType = "append_row";

  return {
    rowsAffected: 1,
    columnsAffected: columnsFromRow(row),
    output: { rowIndex: newIdx },
  };
}

async function handleSheetProgram(
  args: { instruction: string; goal: "answer" | "show_filtered" | "target_rows" },
  ctx: HandlerContext
): Promise<HandlerResult> {
  if (!ctx.sheet) return { assistantMessage: "No sheet loaded yet." };

  // For "answer" goal, just answer the question (no row filtering)
  if (args.goal === "answer") {
    const answer = await answerQuestionAboutSheet({
      rows: ctx.sheet.rows,
      mode: ctx.mode,
      instruction: args.instruction,
      integration: ctx.integrationContext,
      existingColumns: ctx.sheet.columns,
      billingTracker: ctx.billingTracker,
    });
    return { assistantMessage: answer, output: { goal: args.goal } };
  }

  // For "show_filtered" or "target_rows": generate a JS filter, run on ALL rows
  const { filterFnBody, description } = await generateSheetFilterFn({
    mode: ctx.mode,
    instruction: args.instruction,
    integration: ctx.integrationContext,
    existingColumns: ctx.sheet.columns,
    sampleRows: ctx.sheet.rows.slice(0, 5),
    billingTracker: ctx.billingTracker,
  });

  // Execute the filter on every row safely
  let filterFn: (row: Record<string, unknown>) => boolean;
  try {
    filterFn = new Function("row", filterFnBody) as (row: Record<string, unknown>) => boolean;
  } catch (e) {
    return {
      assistantMessage: `Failed to compile filter: ${(e as Error).message}`,
      output: { goal: args.goal, error: "compile_error" },
    };
  }

  const matchedIndexes: number[] = [];
  for (let i = 0; i < ctx.sheet.rows.length; i++) {
    try {
      const row = ctx.sheet.rows[i];
      const normalized = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, String(v ?? "")])
      );
      if (filterFn(normalized)) {
        matchedIndexes.push(i);
      }
    } catch {
      // Skip rows that cause runtime errors in the filter
    }
  }

  // Update working memory with the matched row indexes
  ctx.workingMemory.lastTargetedRowIndexes = matchedIndexes;
  ctx.workingMemory.lastFilterDescription = description || null;
  ctx.workingMemory.lastActionType = "target_rows";

  const total = ctx.sheet.rows.length;
  const matched = matchedIndexes.length;
  const msg = description
    ? `${description} — ${matched} of ${total} rows match.`
    : `Filter applied: ${matched} of ${total} rows match.`;

  return {
    assistantMessage: msg,
    rowsAffected: matched,
    output: {
      goal: args.goal,
      filteredRowIndexes: matchedIndexes,
      matchedCount: matched,
      totalCount: total,
      filterDescription: description,
    },
  };
}

async function handleAnswerQuestion(
  args: { instruction: string },
  ctx: HandlerContext
): Promise<HandlerResult> {
  if (!ctx.sheet) return { assistantMessage: "No sheet loaded." };
  const answer = await answerQuestionAboutSheet({
    rows: ctx.sheet.rows,
    mode: ctx.mode,
    instruction: args.instruction,
    integration: ctx.integrationContext,
    existingColumns: ctx.sheet.columns,
    billingTracker: ctx.billingTracker,
  });
  return { assistantMessage: answer };
}

async function handleResearchWeb(
  args: { instruction: string },
  ctx: HandlerContext
): Promise<HandlerResult> {
  const { summary, sources } = await researchWithWeb({
    instruction: args.instruction,
    integration: ctx.integrationContext,
    sheet: ctx.sheet,
    rowIndexes: ctx.workingMemory.lastTargetedRowIndexes,
    billingTracker: ctx.billingTracker,
  });
  ctx.workingMemory.lastResearchSummary = summary;
  ctx.workingMemory.lastResearchSubject = args.instruction.slice(0, 200);
  ctx.workingMemory.lastActionType = "research_web";

  const sourcesBlock =
    sources.length > 0
      ? "\n\nSources:\n" + sources.slice(0, 5).map((s) => `- ${s.title}: ${s.uri}`).join("\n")
      : "";
  return {
    assistantMessage: summary + sourcesBlock,
    output: { summary: summary.slice(0, 500), sourceCount: sources.length },
  };
}

async function handleAttachmentsAnalyze(
  args: { instruction: string },
  ctx: HandlerContext
): Promise<HandlerResult> {
  const answer = await analyzeAttachments({
    mode: ctx.mode,
    instruction: args.instruction,
    integration: ctx.integrationContext,
    existingColumns: ctx.sheet?.columns ?? [],
    attachments: ctx.attachments,
    billingTracker: ctx.billingTracker,
  });
  return { assistantMessage: answer };
}

async function handleColumnDelete(
  args: { column: string },
  ctx: HandlerContext
): Promise<HandlerResult> {
  if (!ctx.sheet) return { assistantMessage: "No sheet loaded." };
  const col = args.column;
  ctx.sheet.columns = ctx.sheet.columns.filter((c) => c !== col);
  for (const row of ctx.sheet.rows) {
    delete row[col];
  }
  return {
    assistantMessage: `Deleted column "${col}".`,
    columnsAffected: [col],
    output: { deletedColumn: col },
  };
}

async function handleApplyToShopify(
  _args: Record<string, never>,
  ctx: HandlerContext
): Promise<HandlerResult> {
  const integration = requireIntegration(ctx);
  if (!ctx.sheet || !ctx.originalSheet) {
    return { assistantMessage: "No sheet to apply." };
  }

  // Compute diffs between originalSheet and sheet
  const origMap = new Map<string, SyncSheetRow>();
  for (const row of ctx.originalSheet.rows) {
    const id = String(row.id ?? "").trim();
    if (id) origMap.set(id, row);
  }

  // Split rows by entity. A row is a Shopify collection if its id is a
  // Collection GID; everything else is treated as a product. This is the
  // only place we make that distinction — apply.ts only knows about
  // products (productSet), and collections need their own mutation
  // (collectionUpdate). Without this split, edits on a collections sheet
  // were silently dropped because applyShopifyChanges has no concept of
  // a collection row.
  const productCreates: SyncSheetRow[] = [];
  const productUpdates: ApplyUpdate[] = [];
  const collectionUpdates: Array<{ row: SyncSheetRow; changedColumns: string[] }> = [];
  const collectionCreatesIgnored: SyncSheetRow[] = [];

  for (const row of ctx.sheet.rows) {
    const id = String(row.id ?? "").trim();
    const isCollection = id.startsWith("gid://shopify/Collection/");
    const orig = id ? origMap.get(id) : null;

    if (!orig) {
      // Brand-new row with no original — only products support upsert via
      // apply (productSet on handle). Collections must be created by the
      // dedicated `sync_collections_create` tool, not here.
      if (isCollection) {
        collectionCreatesIgnored.push(row);
      } else {
        productCreates.push(row);
      }
      continue;
    }

    const changedColumns = ctx.sheet.columns.filter(
      (col) => String(row[col] ?? "") !== String(orig[col] ?? "")
    );
    if (changedColumns.length === 0) continue;

    if (isCollection) {
      collectionUpdates.push({ row, changedColumns });
    } else {
      productUpdates.push({ productId: id, row, changedColumns });
    }
  }

  const totalPending =
    productCreates.length + productUpdates.length + collectionUpdates.length;
  if (totalPending === 0) {
    const msg =
      collectionCreatesIgnored.length > 0
        ? `No pending changes to apply. ${collectionCreatesIgnored.length} new collection row(s) found locally — use the "create collection" tool to push them, the Sync button only handles edits.`
        : "No pending changes to apply.";
    return { assistantMessage: msg };
  }

  ctx.onProgress?.(`Applying ${totalPending} change(s) to Shopify…`);

  // ── Products path ──────────────────────────────────────────────────────
  let productResult = { createdCount: 0, updatedCount: 0, skippedCount: 0, errors: [] as string[] };
  if (productCreates.length > 0 || productUpdates.length > 0) {
    const input: ApplyChangesInput = {
      integration,
      creates: productCreates,
      updates: productUpdates,
    };
    productResult = await applyShopifyChanges(input);
  }

  // ── Collections path ───────────────────────────────────────────────────
  let collectionResult = { updatedCount: 0, errors: [] as string[] };
  if (collectionUpdates.length > 0) {
    const cr = await applyShopifyCollectionUpdates({
      integration,
      updates: collectionUpdates,
    });
    collectionResult = { updatedCount: cr.updatedCount, errors: cr.errors };
  }

  const totalCreated = productResult.createdCount;
  const totalUpdated = productResult.updatedCount + collectionResult.updatedCount;
  const totalSkipped = productResult.skippedCount;
  const allErrors = [...productResult.errors, ...collectionResult.errors];

  ctx.workingMemory.lastApplyStats = {
    created: totalCreated,
    updated: totalUpdated,
    failed: allErrors.length,
  };
  ctx.workingMemory.lastErrorRows = allErrors.map((reason, i) => ({ rowIndex: i, reason }));
  ctx.workingMemory.lastActionType = "apply_to_shopify";

  const breakdown =
    collectionUpdates.length > 0
      ? ` (products: ${productResult.updatedCount} updated; collections: ${collectionResult.updatedCount} updated)`
      : "";
  const errSuffix =
    allErrors.length > 0 ? ` — ${allErrors.length} error(s): ${allErrors.slice(0, 3).join("; ")}` : "";
  const newCollNote =
    collectionCreatesIgnored.length > 0
      ? ` ${collectionCreatesIgnored.length} new local collection row(s) were not pushed — use the create-collection tool for those.`
      : "";

  return {
    assistantMessage:
      `Applied: ${totalCreated} created, ${totalUpdated} updated, ${totalSkipped} skipped${breakdown}${errSuffix}.${newCollNote}`,
    rowsAffected: totalCreated + totalUpdated,
    userErrorCount: allErrors.length,
    userErrorCodes: [],
    output: {
      products: productResult,
      collections: collectionResult,
      ignoredCollectionCreates: collectionCreatesIgnored.length,
    },
  };
}

async function handleReplyOnly(
  args: { message: string }
): Promise<HandlerResult> {
  return { assistantMessage: args.message };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

export async function executeTool(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: HandlerContext
): Promise<HandlerResult> {
  switch (tool) {
    case "sync_products_load":
      return handleProductsLoad(args as never, ctx);
    case "sync_products_filter_client":
      return handleProductsFilterClient(args as never, ctx);
    case "sync_collections_load":
      return handleCollectionsLoad(args as never, ctx);
    case "sync_collections_resolve":
      return handleCollectionsResolve(args as never, ctx);
    case "sync_collections_create":
      return handleCollectionsCreate(args as never, ctx);
    case "sync_collections_assign":
      return handleCollectionsAssign(args as never, ctx);
    case "sync_collections_delete":
      return handleCollectionsDelete(args as never, ctx);
    case "sync_columns_write_with_ai":
      return handleColumnsWriteWithAi(args as never, ctx);
    case "sync_images_search":
      return handleImagesSearch(args as never, ctx);
    case "sync_row_append":
      return handleRowAppend(args as never, ctx);
    case "sync_sheet_program":
      return handleSheetProgram(args as never, ctx);
    case "sync_answer_question":
      return handleAnswerQuestion(args as never, ctx);
    case "sync_research_web":
      return handleResearchWeb(args as never, ctx);
    case "sync_attachments_analyze":
      return handleAttachmentsAnalyze(args as never, ctx);
    case "sync_column_delete":
      return handleColumnDelete(args as never, ctx);
    case "sync_apply_to_shopify":
      return handleApplyToShopify({} as never, ctx);
    case "sync_reply_only":
      return handleReplyOnly(args as never);
    default: {
      const exhaustive: never = tool;
      throw new Error(`Unknown tool: ${exhaustive}`);
    }
  }
}
