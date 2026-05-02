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

function toText(value: unknown) {
  return String(value ?? "").trim();
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
  const { categoryNames, tagNames } = extractTaxonomyNames(row, allowedColumns);
  if (categoryNames.length > 0) {
    payload.categories = await resolveTerms(client, "/products/categories", categoryNames);
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
): Promise<{ updated: number; skipped: number }> {
  const updateEntries: Record<string, any>[] = [];
  let skipped = 0;
  for (const item of items) {
    const payload = buildWooProductPayload(item.row, item.changedColumns);
    await attachTaxonomies(client, payload, item.row, item.changedColumns);
    if (Object.keys(payload).length === 0) {
      skipped += 1;
      continue;
    }
    updateEntries.push({ id: item.id, ...payload });
  }
  if (updateEntries.length === 0) return { updated: 0, skipped };

  const chunks = chunk(updateEntries, PRODUCTS_BATCH_LIMIT);
  let updated = 0;
  for (const c of chunks) {
    const response = await client.post<{ update?: any[] }>("/products/batch", { update: c });
    if (Array.isArray(response?.update)) {
      updated += response.update.filter((p: any) => p?.id).length;
    } else {
      updated += c.length;
    }
  }
  return { updated, skipped };
}

async function applyVariationBatch(
  client: HttpClient,
  productId: string,
  items: Array<{ id: number; row: SyncSheetRow; changedColumns: string[] }>
): Promise<{ updated: number; skipped: number }> {
  const entries: Record<string, any>[] = [];
  let skipped = 0;
  for (const item of items) {
    const payload = buildWooVariationPayload(item.row, item.changedColumns);
    if (Object.keys(payload).length === 0) {
      skipped += 1;
      continue;
    }
    entries.push({ id: item.id, ...payload });
  }
  if (entries.length === 0) return { updated: 0, skipped };

  const chunks = chunk(entries, VARIATIONS_BATCH_LIMIT);
  let updated = 0;
  for (const c of chunks) {
    const response = await client.post<{ update?: any[] }>(
      `/products/${productId}/variations/batch`,
      { update: c }
    );
    if (Array.isArray(response?.update)) {
      updated += response.update.filter((p: any) => p?.id).length;
    } else {
      updated += c.length;
    }
  }
  return { updated, skipped };
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
