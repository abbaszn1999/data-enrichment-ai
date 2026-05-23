import type { ApplyChangesInput, ApplyChangesResult, IntegrationRecord, SyncSheetRow } from "../../core/types";
import { runWithConcurrency, chunk } from "../../core/batch-executor";
import { createWooClient } from "./client";
import {
  buildWooProductPayload,
  buildWooVariationPayload,
  extractTaxonomyNames,
} from "./payload-builders";
import { resolveTerms } from "./taxonomy";
import type { HttpClient } from "../../core/http-client";

const PRODUCTS_BATCH_LIMIT = 100;
const VARIATIONS_BATCH_LIMIT = 100;
const CONCURRENCY = 2;
const BATCH_DELAY_MS = 750;

type BatchApplyResult = {
  updated: number;
  skipped: number;
  errors: string[];
};

function toText(value: unknown) {
  return String(value ?? "").trim();
}

function hasChangedColumn(changedColumns: string[], column: string) {
  return changedColumns.length === 0 || changedColumns.includes(column);
}

function formatWooItemError(scope: string, item: any) {
  const error = item?.error ?? item;
  const code = toText(error?.code);
  const message = toText(error?.message) || "Unknown WooCommerce batch item error";
  return `${scope}: ${message}${code ? ` [${code}]` : ""}`;
}

function validateProductBatchItem(item: any, source: { id: number; row: SyncSheetRow; changedColumns: string[] }) {
  const errors: string[] = [];
  const scope = `Product ${source.id}`;
  if (item?.error || !item?.id) {
    errors.push(formatWooItemError(scope, item));
    return errors;
  }
  if (hasChangedColumn(source.changedColumns, "featured_image") && toText(source.row.featured_image)) {
    const images = Array.isArray(item.images) ? item.images : [];
    if (images.length === 0 || !toText(images[0]?.src)) {
      errors.push(`${scope}: WooCommerce did not return an attached image for featured_image`);
    }
  }
  return errors;
}

function validateVariationBatchItem(item: any, source: { id: number; row: SyncSheetRow; changedColumns: string[] }, productId: string) {
  const errors: string[] = [];
  const scope = `Product ${productId} variation ${source.id}`;
  if (item?.error || !item?.id) {
    errors.push(formatWooItemError(scope, item));
    return errors;
  }
  if (hasChangedColumn(source.changedColumns, "featured_image") && toText(source.row.featured_image)) {
    if (!toText(item.image?.src)) {
      errors.push(`${scope}: WooCommerce did not return an attached variation image for featured_image`);
    }
  }
  return errors;
}

function isVariationUpdate(row: SyncSheetRow, productId: string) {
  // If row carries variation_id distinct from productId, treat as variation update.
  const variationId = toText(row.variation_id);
  return Boolean(variationId) && variationId !== toText(productId);
}

async function attachTaxonomies(
  client: HttpClient,
  payload: Record<string, any>,
  row: SyncSheetRow,
  allowedColumns?: string[]
) {
  const { categoryIds, categoryNames, tagNames } = extractTaxonomyNames(row, allowedColumns);
  if (categoryIds.length > 0 || categoryNames.length > 0) {
    payload.categories = await resolveTerms(client, "/products/categories", categoryNames, categoryIds);
  }
  if (tagNames.length > 0) {
    payload.tags = await resolveTerms(client, "/products/tags", tagNames);
  }
}

/** Group updates by parent productId and split into product-level vs variation-level. */
function groupUpdates(updates: ApplyChangesInput["updates"]) {
  const productUpdates: Array<{ id: number; row: SyncSheetRow; changedColumns: string[] }> = [];
  const variationUpdatesByProduct = new Map<
    string,
    Array<{ id: number; row: SyncSheetRow; changedColumns: string[] }>
  >();

  for (const u of updates) {
    const productId = toText(u.productId);
    if (!productId) continue;
    const id = Number(productId);
    if (!Number.isFinite(id)) continue;
    const changed = Array.isArray(u.changedColumns) ? u.changedColumns : [];

    if (isVariationUpdate(u.row ?? {}, productId)) {
      const variationId = Number(toText(u.row?.variation_id));
      if (!Number.isFinite(variationId)) continue;
      const list = variationUpdatesByProduct.get(productId) ?? [];
      list.push({ id: variationId, row: u.row ?? {}, changedColumns: changed });
      variationUpdatesByProduct.set(productId, list);
    } else {
      productUpdates.push({ id, row: u.row ?? {}, changedColumns: changed });
    }
  }
  return { productUpdates, variationUpdatesByProduct };
}

async function applyProductBatch(
  client: HttpClient,
  items: Array<{ id: number; row: SyncSheetRow; changedColumns: string[] }>
): Promise<BatchApplyResult> {
  const updateEntries: Record<string, any>[] = [];
  const updateSources: Array<{ id: number; row: SyncSheetRow; changedColumns: string[] }> = [];
  let skipped = 0;
  for (const item of items) {
    const payload = buildWooProductPayload(item.row, item.changedColumns);
    await attachTaxonomies(client, payload, item.row, item.changedColumns);
    if (Object.keys(payload).length === 0) {
      skipped += 1;
      continue;
    }
    updateEntries.push({ id: item.id, ...payload });
    updateSources.push(item);
  }
  if (updateEntries.length === 0) return { updated: 0, skipped, errors: [] };

  const chunks = chunk(updateEntries, PRODUCTS_BATCH_LIMIT);
  const sourceChunks = chunk(updateSources, PRODUCTS_BATCH_LIMIT);
  let updated = 0;
  const errors: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i] ?? [];
    const sources = sourceChunks[i] ?? [];
    const response = await client.post<{ update?: any[] }>("/products/batch", { update: c });
    if (Array.isArray(response?.update)) {
      response.update.forEach((item: any, index: number) => {
        const itemErrors = validateProductBatchItem(item, sources[index] ?? c[index]);
        if (itemErrors.length > 0) {
          errors.push(...itemErrors);
        } else {
          updated += 1;
        }
      });
    } else {
      errors.push("WooCommerce product batch returned no update array");
    }
  }
  return { updated, skipped, errors };
}

async function applyVariationBatch(
  client: HttpClient,
  productId: string,
  items: Array<{ id: number; row: SyncSheetRow; changedColumns: string[] }>
): Promise<BatchApplyResult> {
  const entries: Record<string, any>[] = [];
  const sources: Array<{ id: number; row: SyncSheetRow; changedColumns: string[] }> = [];
  let skipped = 0;
  for (const item of items) {
    const payload = buildWooVariationPayload(item.row, item.changedColumns);
    if (Object.keys(payload).length === 0) {
      skipped += 1;
      continue;
    }
    entries.push({ id: item.id, ...payload });
    sources.push(item);
  }
  if (entries.length === 0) return { updated: 0, skipped, errors: [] };

  const chunks = chunk(entries, VARIATIONS_BATCH_LIMIT);
  const sourceChunks = chunk(sources, VARIATIONS_BATCH_LIMIT);
  let updated = 0;
  const errors: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i] ?? [];
    const chunkSources = sourceChunks[i] ?? [];
    const response = await client.post<{ update?: any[] }>(
      `/products/${productId}/variations/batch`,
      { update: c }
    );
    if (Array.isArray(response?.update)) {
      response.update.forEach((item: any, index: number) => {
        const itemErrors = validateVariationBatchItem(item, chunkSources[index] ?? c[index], productId);
        if (itemErrors.length > 0) {
          errors.push(...itemErrors);
        } else {
          updated += 1;
        }
      });
    } else {
      errors.push(`WooCommerce variation batch for product ${productId} returned no update array`);
    }
  }
  return { updated, skipped, errors };
}

async function createWooProduct(client: HttpClient, row: SyncSheetRow): Promise<void> {
  const payload = buildWooProductPayload(row);
  await attachTaxonomies(client, payload, row);
  if (!toText(payload.name)) {
    throw new Error("Cannot create a WooCommerce product without a title");
  }
  if (!payload.type) payload.type = "simple";
  await client.post("/products", payload);
}

export async function applyWooCommerceChanges(input: ApplyChangesInput): Promise<ApplyChangesResult> {
  const client = createWooClient(input.integration);
  const errors: string[] = [];

  const { productUpdates, variationUpdatesByProduct } = groupUpdates(input.updates);

  // Phase 1: Product-level batch updates
  let updatedCount = 0;
  let skippedCount = 0;
  if (productUpdates.length > 0) {
    // Run taxonomy + payload prep in chunks to limit concurrent term lookups.
    const chunks = chunk(productUpdates, PRODUCTS_BATCH_LIMIT);
    const result = await runWithConcurrency(
      chunks,
      async (c) => applyProductBatch(client, c),
      { concurrency: CONCURRENCY, delayMsBetweenBatches: BATCH_DELAY_MS }
    );
    for (const r of result.successes) {
      updatedCount += r.updated;
      skippedCount += r.skipped;
      errors.push(...r.errors);
    }
    errors.push(...result.errors.map((e) => e.error));
  }

  // Phase 2: Variation-level batch updates per product
  const variationProductIds = Array.from(variationUpdatesByProduct.keys());
  if (variationProductIds.length > 0) {
    const result = await runWithConcurrency(
      variationProductIds,
      async (productId) => {
        const items = variationUpdatesByProduct.get(productId) ?? [];
        return applyVariationBatch(client, productId, items);
      },
      { concurrency: CONCURRENCY, delayMsBetweenBatches: BATCH_DELAY_MS }
    );
    for (const r of result.successes) {
      updatedCount += r.updated;
      skippedCount += r.skipped;
      errors.push(...r.errors);
    }
    errors.push(...result.errors.map((e) => e.error));
  }

  // Phase 3: Creates
  let createdCount = 0;
  if (input.creates.length > 0) {
    const result = await runWithConcurrency(
      input.creates,
      async (row) => createWooProduct(client, row ?? {}),
      { concurrency: CONCURRENCY, delayMsBetweenBatches: BATCH_DELAY_MS }
    );
    createdCount = result.successes.length;
    errors.push(...result.errors.map((e) => e.error));
  }

  return { createdCount, updatedCount, skippedCount, errors };
}
