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
import {
  SHOPIFY_MAX_MEDIA_PER_PRODUCT,
  galleryUrlKey,
  parseGalleryImages,
  parseGalleryMedia,
} from "../../core/gallery-images";
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
  warnings: string[];
};

type MediaToCreate = { originalSource: string; alt?: string };

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function hasChangedColumn(item: SyncApplyItem, column: string): boolean {
  return !item.changedColumns || item.changedColumns.includes(column);
}

/**
 * Works out which images still need uploading for an existing product.
 *
 * Media on a live product is added with productCreateMedia (append-only), never
 * with productSet's `files` field — that one is an upsert and deletes whatever
 * the payload omits. Anything already attached is skipped so re-applying the
 * same sheet is a no-op instead of piling up duplicates.
 */
function planProductMedia(item: SyncApplyItem): {
  media: MediaToCreate[];
  droppedFromGallery: number;
  overCapCount: number;
} {
  const media: MediaToCreate[] = [];
  const attachedKeys = new Set<string>();

  const featuredUrl = toText(item.row.featured_image);
  const existingGallery = parseGalleryMedia(item.row.gallery_media);
  for (const entry of existingGallery) {
    if (entry.src) attachedKeys.add(galleryUrlKey(entry.src));
  }

  if (hasChangedColumn(item, "featured_image") && featuredUrl) {
    media.push({
      originalSource: featuredUrl,
      alt: toText(item.row.featured_image_alt_text || item.row.title) || undefined,
    });
    attachedKeys.add(galleryUrlKey(featuredUrl));
  } else if (featuredUrl) {
    attachedKeys.add(galleryUrlKey(featuredUrl));
  }

  let droppedFromGallery = 0;
  if (hasChangedColumn(item, "gallery_images")) {
    const desired = parseGalleryImages(item.row.gallery_images);
    const desiredKeys = new Set(desired.map(galleryUrlKey));
    for (const url of desired) {
      const key = galleryUrlKey(url);
      if (attachedKeys.has(key)) continue;
      attachedKeys.add(key);
      media.push({ originalSource: url });
    }
    // Removing media needs productDeleteMedia, which this path deliberately
    // does not do — deletions are reported instead of silently ignored.
    droppedFromGallery = existingGallery.filter(
      (entry) => entry.src && !desiredKeys.has(galleryUrlKey(entry.src))
    ).length;
  }

  // Respect Shopify's hard 250-media-per-product ceiling.
  const attachedCount = existingGallery.length + (featuredUrl ? 1 : 0);
  const room = Math.max(0, SHOPIFY_MAX_MEDIA_PER_PRODUCT - attachedCount);
  const overCapCount = Math.max(0, media.length - room);
  return {
    media: overCapCount > 0 ? media.slice(0, room) : media,
    droppedFromGallery,
    overCapCount,
  };
}

async function createProductMedia(params: {
  integration: IntegrationRecord;
  productId: string;
  media: MediaToCreate[];
}): Promise<string[]> {
  if (params.media.length === 0) return [];
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
      // One request carries every image: productCreateMedia accepts an array and
      // adds all valid entries, reporting per-file errors for the rest.
      media: params.media.map((entry) => ({
        originalSource: entry.originalSource,
        mediaContentType: "IMAGE",
        ...(entry.alt ? { alt: entry.alt } : {}),
      })),
    },
    options: {
      estimatedCost: 10 + params.media.length * 2,
      tag: "productCreateMedia",
    },
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
  // Existing products route all media through productCreateMedia; only brand-new
  // products get their images inline via productSet's `files`.
  const mediaEligible =
    !item.isCreate && toText(item.row.id).startsWith("gid://shopify/Product/");
  const mediaPlan = mediaEligible
    ? planProductMedia(item)
    : { media: [] as MediaToCreate[], droppedFromGallery: 0, overCapCount: 0 };
  const warnings: string[] = [];
  if (mediaPlan.droppedFromGallery > 0) {
    warnings.push(
      `${mediaPlan.droppedFromGallery} gallery image(s) were removed in the sheet but stay on the product — deleting store media is not done automatically.`
    );
  }
  if (mediaPlan.overCapCount > 0) {
    warnings.push(
      `${mediaPlan.overCapCount} image(s) skipped — the product is at Shopify's limit of ${SHOPIFY_MAX_MEDIA_PER_PRODUCT} media files.`
    );
  }

  const built = buildProductSetInput(item.row, {
    changedColumns: mediaEligible
      ? (item.changedColumns ?? []).filter(
          (col) => col !== "featured_image" && col !== "gallery_images"
        )
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
      warnings,
    };
  }

  // If there's nothing to change, skip the mutation entirely.
  const hasChanges = Object.keys(built.input).some(
    (k) => k !== "handle" // handle is always present as identifier duplicate
  );
  if (!hasChanges) {
    if (mediaPlan.media.length > 0) {
      const mediaErrors = await createProductMedia({
        integration,
        productId: toText(item.row.id),
        media: mediaPlan.media,
      });
      return {
        ok: mediaErrors.length === 0,
        created: false,
        updated: mediaErrors.length === 0,
        skipped: false,
        handle: built.identifier.handle,
        errors: mediaErrors,
        warnings,
      };
    }
    return {
      ok: true,
      created: false,
      updated: false,
      skipped: true,
      handle: built.identifier.handle,
      errors: [],
      warnings,
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
      warnings,
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
      warnings,
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
      warnings,
    };
  }

  if (mediaPlan.media.length > 0) {
    const mediaErrors = await createProductMedia({
      integration,
      productId: toText(item.row.id),
      media: mediaPlan.media,
    });
    if (mediaErrors.length > 0) {
      return {
        ok: false,
        created: false,
        updated: false,
        skipped: false,
        handle: built.identifier.handle,
        errors: mediaErrors.map((e) => `media: ${e}`),
        warnings,
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
    warnings,
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
  const warnings: string[] = [];

  for (const outcome of result.successes) {
    for (const warning of outcome.warnings) {
      warnings.push(`[${outcome.handle || "<no-handle>"}] ${warning}`);
    }
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
    warnings,
  };
}

// ─── Bulk-path (async productSet via bulkOperationRunMutation) ───────────────

async function applyBulkPath(
  integration: IntegrationRecord,
  items: SyncApplyItem[]
): Promise<ApplyChangesResult & { bulkOperationId?: string }> {
  // Image columns are stripped from the JSONL for existing products: productSet
  // treats `files` as the product's complete media list, so a bulk payload
  // carrying one image would wipe every other picture on the product. Media for
  // those rows is added afterwards through the append-only media mutation.
  const jsonlLines: string[] = [];
  const mediaItems: SyncApplyItem[] = [];
  for (const item of items) {
    const routesMediaSeparately =
      !item.isCreate && toText(item.row.id).startsWith("gid://shopify/Product/");
    const changedColumns = routesMediaSeparately
      ? (item.changedColumns ?? []).filter(
          (col) => col !== "featured_image" && col !== "gallery_images"
        )
      : item.changedColumns ?? undefined;
    jsonlLines.push(buildProductSetJsonlLine(item.row, changedColumns));
    if (routesMediaSeparately) mediaItems.push(item);
  }
  const jsonlContent = jsonlLines.join("\n") + "\n";

  const submitted = await submitBulkMutation({
    integration,
    mutation: PRODUCT_SET_BULK_MUTATION,
    jsonlContent,
    filename: `product-set-${Date.now()}.jsonl`,
  });

  const mediaOutcome = await applyMediaOnly(integration, mediaItems);

  // We don't poll here — the caller (agent route) returns a pending result
  // and can query Shopify's `bulkOperation(id:)` later for final counts.
  // For the synchronous API response we return optimistic "submitted" counts.
  return {
    createdCount: 0,
    updatedCount: items.length,
    skippedCount: 0,
    errors: mediaOutcome.errors,
    warnings: mediaOutcome.warnings,
    bulkOperationId: submitted.id,
  };
}

/** Uploads pending media for rows whose other fields went through bulk JSONL. */
async function applyMediaOnly(
  integration: IntegrationRecord,
  items: SyncApplyItem[]
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pending = items
    .map((item) => ({ item, plan: planProductMedia(item) }))
    .filter(
      ({ plan }) =>
        plan.media.length > 0 || plan.droppedFromGallery > 0 || plan.overCapCount > 0
    );
  if (pending.length === 0) return { errors, warnings };

  const result = await runWithConcurrency(
    pending,
    async ({ item, plan }) => {
      const label = toText(item.row.handle) || toText(item.row.id) || "<no-handle>";
      if (plan.droppedFromGallery > 0) {
        warnings.push(
          `[${label}] ${plan.droppedFromGallery} gallery image(s) were removed in the sheet but stay on the product — deleting store media is not done automatically.`
        );
      }
      if (plan.overCapCount > 0) {
        warnings.push(
          `[${label}] ${plan.overCapCount} image(s) skipped — the product is at Shopify's limit of ${SHOPIFY_MAX_MEDIA_PER_PRODUCT} media files.`
        );
      }
      if (plan.media.length === 0) return;
      const mediaErrors = await createProductMedia({
        integration,
        productId: toText(item.row.id),
        media: plan.media,
      });
      for (const err of mediaErrors) errors.push(`[${label}] media: ${err}`);
    },
    { concurrency: 3, delayMsBetweenBatches: 500 }
  );

  for (const err of result.errors) {
    errors.push(`Media batch error at index ${err.index}: ${err.error}`);
  }
  return { errors, warnings };
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
