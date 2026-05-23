// Shopify apply — productSet mutation (sync) or bulkOperationRunMutation (async).
//
// Path selection:
//   N ≤ 25          → loop productSet, concurrency-limited, cost-aware throttling
//   N > 25           → bulkOperationRunMutation with JSONL upload
//
// All upserts use `identifier: { handle }` (customId path has a known metafields bug).
// Per-row userErrors are surfaced in the returned errors array.

import type {
  ApplyChangesInput,
  ApplyChangesResult,
  IntegrationRecord,
  SyncSheetRow,
} from "../../core/types";
import { runWithConcurrency } from "../../core/batch-executor";
import { shopifyGraphQL } from "./graphql-client";
import { submitBulkMutation } from "./bulk-ops";
import {
  buildProductSetInput,
  buildProductSetJsonlLine,
} from "./payload-builders";

// ─── GraphQL documents ────────────────────────────────────────────────────────

const PRODUCT_SET_SYNC = /* GraphQL */ `
  mutation ProductSetSync($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
    productSet(input: $input, identifier: $identifier, synchronous: true) {
      product {
        id
        handle
        title
        updatedAt
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

// For bulk mutation — must have exactly one connection in the response path.
// We keep it minimal: just report back {id handle} + userErrors per row.
const PRODUCT_SET_BULK_MUTATION = /* GraphQL */ `
  mutation ProductSetBulk($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
    productSet(input: $input, identifier: $identifier, synchronous: true) {
      product { id handle }
      userErrors { field message code }
    }
  }
`;

const PRODUCT_CREATE_MEDIA = /* GraphQL */ `
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        alt
        mediaContentType
        status
      }
      mediaUserErrors { field message code }
      userErrors { field message }
      product { id handle }
    }
  }
`;

// ─── Sync-path ────────────────────────────────────────────────────────────────

type SyncApplyItem = {
  row: SyncSheetRow;
  changedColumns: string[] | null;
  isCreate: boolean;
};

type SyncApplyOutcome = {
  ok: boolean;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  handle: string;
  errors: string[];
};

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function hasChangedColumn(item: SyncApplyItem, column: string): boolean {
  return !item.changedColumns || item.changedColumns.includes(column);
}

async function createProductMedia(params: {
  integration: IntegrationRecord;
  productId: string;
  imageUrl: string;
  alt?: string;
}): Promise<string[]> {
  const res = await shopifyGraphQL<{
    productCreateMedia: {
      media: Array<{ alt?: string | null; mediaContentType?: string | null; status?: string | null }>;
      mediaUserErrors: Array<{ field: string[] | null; message: string; code?: string }>;
      userErrors: Array<{ field: string[] | null; message: string }>;
      product: { id?: string; handle?: string } | null;
    };
  }>({
    integration: params.integration,
    query: PRODUCT_CREATE_MEDIA,
    variables: {
      productId: params.productId,
      media: [
        {
          originalSource: params.imageUrl,
          mediaContentType: "IMAGE",
          ...(params.alt ? { alt: params.alt } : {}),
        },
      ],
    },
    options: { estimatedCost: 12, tag: "productCreateMedia" },
  });

  const errors: string[] = [];
  if (res.errors.length > 0) {
    errors.push(...res.errors.map((e) => e.message));
  }
  const payload = res.data?.productCreateMedia;
  if (!payload) {
    errors.push("productCreateMedia returned no payload");
    return errors;
  }
  errors.push(
    ...payload.mediaUserErrors.map(
      (e) => `${e.field ? e.field.join(".") + ": " : ""}${e.message}${e.code ? ` [${e.code}]` : ""}`
    ),
    ...payload.userErrors.map(
      (e) => `${e.field ? e.field.join(".") + ": " : ""}${e.message}`
    )
  );
  return errors;
}

async function applyOneProductSet(params: {
  integration: IntegrationRecord;
  item: SyncApplyItem;
}): Promise<SyncApplyOutcome> {
  const { integration, item } = params;
  const shouldCreateMedia =
    !item.isCreate &&
    hasChangedColumn(item, "featured_image") &&
    toText(item.row.id).startsWith("gid://shopify/Product/") &&
    !!toText(item.row.featured_image);
  const built = buildProductSetInput(item.row, {
    changedColumns: shouldCreateMedia
      ? (item.changedColumns ?? []).filter((col) => col !== "featured_image")
      : item.changedColumns ?? undefined,
  });

  if (!built.identifier.handle) {
    return {
      ok: false,
      created: false,
      updated: false,
      skipped: false,
      handle: "",
      errors: ["Missing handle — productSet upsert requires a handle"],
    };
  }

  // If there's nothing to change, skip the mutation entirely.
  const hasChanges = Object.keys(built.input).some(
    (k) => k !== "handle" // handle is always present as identifier duplicate
  );
  if (!hasChanges) {
    if (shouldCreateMedia) {
      const mediaErrors = await createProductMedia({
        integration,
        productId: toText(item.row.id),
        imageUrl: toText(item.row.featured_image),
        alt: toText(item.row.featured_image_alt_text || item.row.title),
      });
      return {
        ok: mediaErrors.length === 0,
        created: false,
        updated: mediaErrors.length === 0,
        skipped: false,
        handle: built.identifier.handle,
        errors: mediaErrors,
      };
    }
    return {
      ok: true,
      created: false,
      updated: false,
      skipped: true,
      handle: built.identifier.handle,
      errors: [],
    };
  }

  // Cost estimate: base 10 + 0.4 per metafield + 1.9 per file + 1 per variant
  const metafieldCost = 0;
  const files = Array.isArray(built.input.files) ? (built.input.files as unknown[]).length : 0;
  const variants = Array.isArray(built.input.variants) ? (built.input.variants as unknown[]).length : 0;
  const estimatedCost = Math.ceil(10 + metafieldCost * 0.4 + files * 1.9 + variants * 1);

  const res = await shopifyGraphQL<{
    productSet: {
      product: { id?: string; handle?: string } | null;
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    };
  }>({
    integration,
    query: PRODUCT_SET_SYNC,
    variables: {
      input: built.input,
      identifier: built.identifier,
    },
    options: { estimatedCost, tag: "productSet" },
  });

  if (res.errors.length > 0) {
    return {
      ok: false,
      created: false,
      updated: false,
      skipped: false,
      handle: built.identifier.handle,
      errors: res.errors.map((e) => e.message),
    };
  }

  const payload = res.data?.productSet;
  if (!payload) {
    return {
      ok: false,
      created: false,
      updated: false,
      skipped: false,
      handle: built.identifier.handle,
      errors: ["productSet returned no payload"],
    };
  }

  if (payload.userErrors.length > 0) {
    return {
      ok: false,
      created: false,
      updated: false,
      skipped: false,
      handle: built.identifier.handle,
      errors: payload.userErrors.map(
        (e) => `${e.field ? e.field.join(".") + ": " : ""}${e.message}${e.code ? ` [${e.code}]` : ""}`
      ),
    };
  }

  if (shouldCreateMedia) {
    const mediaErrors = await createProductMedia({
      integration,
      productId: toText(item.row.id),
      imageUrl: toText(item.row.featured_image),
      alt: toText(item.row.featured_image_alt_text || item.row.title),
    });
    if (mediaErrors.length > 0) {
      return {
        ok: false,
        created: false,
        updated: false,
        skipped: false,
        handle: built.identifier.handle,
        errors: mediaErrors.map((e) => `media: ${e}`),
      };
    }
  }

  const updated = !item.isCreate;
  const created = item.isCreate;
  return {
    ok: true,
    created,
    updated,
    skipped: false,
    handle: built.identifier.handle,
    errors: [],
  };
}

async function applySyncPath(
  integration: IntegrationRecord,
  items: SyncApplyItem[]
): Promise<ApplyChangesResult> {
  const result = await runWithConcurrency(
    items,
    (item) => applyOneProductSet({ integration, item }),
    { concurrency: 3, delayMsBetweenBatches: 500 }
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const outcome of result.successes) {
    if (!outcome.ok) {
      errors.push(
        `[${outcome.handle || "<no-handle>"}] ${outcome.errors.join("; ") || "Unknown error"}`
      );
      continue;
    }
    if (outcome.skipped) skipped += 1;
    if (outcome.created) created += 1;
    if (outcome.updated) updated += 1;
  }

  for (const err of result.errors) {
    errors.push(`Batch error at index ${err.index}: ${err.error}`);
  }

  return {
    createdCount: created,
    updatedCount: updated,
    skippedCount: skipped,
    errors,
  };
}

// ─── Bulk-path (async productSet via bulkOperationRunMutation) ───────────────

async function applyBulkPath(
  integration: IntegrationRecord,
  items: SyncApplyItem[]
): Promise<ApplyChangesResult & { bulkOperationId?: string }> {
  const jsonlLines: string[] = [];
  for (const item of items) {
    jsonlLines.push(
      buildProductSetJsonlLine(item.row, item.changedColumns ?? undefined)
    );
  }
  const jsonlContent = jsonlLines.join("\n") + "\n";

  const submitted = await submitBulkMutation({
    integration,
    mutation: PRODUCT_SET_BULK_MUTATION,
    jsonlContent,
    filename: `product-set-${Date.now()}.jsonl`,
  });

  // We don't poll here — the caller (agent route) can:
  //   (a) record the bulk op id in sync_bulk_operations,
  //   (b) return a pending result to the user,
  //   (c) let the webhook or a follow-up poll finalize counts.
  //
  // For the synchronous API response we return optimistic "submitted" counts.
  return {
    createdCount: 0,
    updatedCount: items.length,
    skippedCount: 0,
    errors: [],
    bulkOperationId: submitted.id,
  };
}

// ─── Public entry-point (used by provider registry) ──────────────────────────

export async function applyShopifyChanges(
  input: ApplyChangesInput
): Promise<ApplyChangesResult> {
  const { integration, creates, updates } = input;

  const items: SyncApplyItem[] = [
    ...creates
      .filter((row) => row && typeof row === "object")
      .map((row) => ({
        row: row as SyncSheetRow,
        changedColumns: null,
        isCreate: true,
      })),
    ...updates
      .filter((u) => u && typeof u.row === "object")
      .map((u) => ({
        row: u.row,
        changedColumns: Array.isArray(u.changedColumns) ? u.changedColumns : null,
        isCreate: false,
      })),
  ];

  if (items.length === 0) {
    return { createdCount: 0, updatedCount: 0, skippedCount: 0, errors: [] };
  }

  if (items.length <= 25) {
    return applySyncPath(integration, items);
  }
  return applyBulkPath(integration, items);
}
