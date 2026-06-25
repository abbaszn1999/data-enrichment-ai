import type {
  IntegrationRecord,
  ResolvedTaxonomy,
  SyncSheet,
  SyncSheetRow,
} from "@/lib/sync/core/types";
import { ValidationError } from "@/lib/sync/core/errors";
import { createWooClient } from "./client";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type WooCategory = {
  id?: number;
  name?: string;
  slug?: string;
  parent?: number;
  description?: string;
  display?: string;
  image?: { id?: number; src?: string; name?: string; alt?: string } | null;
  menu_order?: number;
  count?: number;
};

export type CreateWooCategoryInput = {
  name: string;
  slug?: string;
  parent?: number;
  description?: string;
  imageId?: number;
};

const WOO_CATEGORY_COLUMNS = [
  "id",
  "name",
  "slug",
  "parent",
  "description",
  "image",
  "count",
];

function categoryToRow(category: WooCategory): SyncSheetRow {
  return {
    id: category.id ?? "",
    name: category.name ?? "",
    slug: category.slug ?? "",
    parent: category.parent ?? 0,
    description: category.description ?? "",
    image: category.image?.src ?? "",
    count: category.count ?? 0,
  };
}

export async function fetchWooCommerceCategories(input: {
  integration: IntegrationRecord;
  query?: string;
  limit?: number;
}): Promise<SyncSheet> {
  const client = createWooClient(input.integration);
  const perPage = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const rows: SyncSheetRow[] = [];
  let page = 1;
  const maxRows = input.limit ?? 50;

  while (rows.length < maxRows) {
    const response = await client.get<WooCategory[]>("/products/categories", {
      per_page: Math.min(perPage, maxRows - rows.length),
      page,
      search: input.query?.trim() || undefined,
      hide_empty: false,
    });
    if (!Array.isArray(response) || response.length === 0) break;
    rows.push(...response.map(categoryToRow));
    if (response.length < perPage) break;
    page += 1;
  }

  return {
    title: "WooCommerce Categories",
    columns: WOO_CATEGORY_COLUMNS,
    rows,
  };
}

export async function createWooCommerceCategory(input: {
  integration: IntegrationRecord;
  category: CreateWooCategoryInput;
}): Promise<SyncSheetRow> {
  const client = createWooClient(input.integration);
  const payload: Record<string, unknown> = {
    name: input.category.name,
  };

  if (input.category.slug) payload.slug = input.category.slug;
  if (typeof input.category.parent === "number") payload.parent = input.category.parent;
  if (input.category.description) payload.description = input.category.description;
  if (typeof input.category.imageId === "number") payload.image = { id: input.category.imageId };

  const created = await client.post<WooCategory>("/products/categories", payload);
  return categoryToRow(created);
}

/** Resolve a WooCommerce product category by exact name/slug (case-insensitive). */
export async function resolveWooCategoryByName(input: {
  integration: IntegrationRecord;
  name: string;
}): Promise<ResolvedTaxonomy | null> {
  const client = createWooClient(input.integration);
  const search = input.name.trim();
  if (!search) return null;
  const list = await client.get<WooCategory[]>("/products/categories", {
    search,
    per_page: 100,
    hide_empty: false,
  });
  if (!Array.isArray(list) || list.length === 0) return null;
  const lower = search.toLowerCase();
  const exact = list.find(
    (c) => (c.name ?? "").toLowerCase() === lower || (c.slug ?? "").toLowerCase() === lower
  );
  const chosen = exact ?? list[0];
  if (!chosen?.id) return null;
  return { id: String(chosen.id), handle: chosen.slug, title: chosen.name };
}

/**
 * Assign products to a WooCommerce category. WooCommerce has no "add products
 * to category" endpoint — categories live on the product — so we fetch each
 * product's current categories and append (never replace), then push via the
 * batch endpoint. Chunked to the batch limit.
 */
export async function assignProductsToWooCategory(input: {
  integration: IntegrationRecord;
  categoryId: string;
  productIds: string[];
}): Promise<{ assignedCount: number }> {
  const client = createWooClient(input.integration);
  const catId = Number(input.categoryId);
  if (!Number.isInteger(catId)) {
    throw new ValidationError(`Invalid WooCommerce category id: ${input.categoryId}`, {
      provider: "woocommerce",
    });
  }
  const ids = input.productIds.map(Number).filter((n) => Number.isInteger(n));
  if (ids.length === 0) return { assignedCount: 0 };

  let assignedCount = 0;
  for (const idChunk of chunk(ids, 100)) {
    // Fetch current categories so the assignment is additive.
    const products = await client.get<Array<{ id: number; categories?: Array<{ id: number }> }>>(
      "/products",
      { include: idChunk.join(","), per_page: 100 }
    );
    const currentById = new Map<number, number[]>();
    for (const p of Array.isArray(products) ? products : []) {
      currentById.set(
        p.id,
        (p.categories ?? []).map((c) => c.id).filter((n) => Number.isInteger(n))
      );
    }
    const update = idChunk.map((id) => {
      const merged = Array.from(new Set([...(currentById.get(id) ?? []), catId]));
      return { id, categories: merged.map((cid) => ({ id: cid })) };
    });
    await client.post("/products/batch", { update });
    assignedCount += update.length;
  }
  return { assignedCount };
}

/**
 * Apply edits to existing WooCommerce product categories via the batch
 * endpoint (POST /products/categories/batch → { update: [{ id, … }] }).
 *
 * Only writable category fields are sent — `id` is the key and `count` is
 * read-only, so both are skipped. `image` is written as { src } when the cell
 * holds a URL (WooCommerce sideloads it) or cleared with null when emptied.
 * Chunked to the WooCommerce batch limit (100).
 *
 * Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/#batch-update-product-categories
 */
export async function updateWooCommerceCategories(input: {
  integration: IntegrationRecord;
  updates: Array<{ id: string; row: SyncSheetRow; changedColumns: string[] }>;
}): Promise<{ updatedCount: number; errors: string[] }> {
  const client = createWooClient(input.integration);
  const errors: string[] = [];

  const batchItems: Array<Record<string, unknown>> = [];
  for (const u of input.updates) {
    const numId = Number(u.id);
    if (!Number.isInteger(numId)) {
      errors.push(`Invalid category id: ${u.id}`);
      continue;
    }
    const item: Record<string, unknown> = { id: numId };
    for (const col of u.changedColumns) {
      const value = u.row[col];
      switch (col) {
        case "id":
        case "count":
          break; // key / read-only
        case "name":
          item.name = String(value ?? "");
          break;
        case "slug":
          item.slug = String(value ?? "");
          break;
        case "description":
          item.description = String(value ?? "");
          break;
        case "parent": {
          const p = Number(value);
          item.parent = Number.isInteger(p) ? p : 0;
          break;
        }
        case "image": {
          const src = String(value ?? "").trim();
          item.image = src ? { src } : null;
          break;
        }
        default:
          // Unknown column — pass through verbatim so future fields work.
          item[col] = value;
      }
    }
    // Only push if there is something to update beyond the id.
    if (Object.keys(item).length > 1) batchItems.push(item);
  }

  if (batchItems.length === 0) return { updatedCount: 0, errors };

  let updatedCount = 0;
  for (const itemChunk of chunk(batchItems, 100)) {
    try {
      const result = await client.post<{ update?: Array<{ id?: number; error?: { message?: string } }> }>(
        "/products/categories/batch",
        { update: itemChunk }
      );
      for (const r of result?.update ?? []) {
        if (r?.error) {
          errors.push(`Category ${r.id ?? "?"}: ${r.error.message ?? "update failed"}`);
        } else {
          updatedCount += 1;
        }
      }
    } catch (err) {
      errors.push((err as Error).message || "batch update failed");
    }
  }
  return { updatedCount, errors };
}

/** Permanently delete WooCommerce product categories (force=true). */
export async function deleteWooCategories(input: {
  integration: IntegrationRecord;
  ids: string[];
}): Promise<{ deletedIds: string[]; failed: Array<{ id: string; error: string }> }> {
  const client = createWooClient(input.integration);
  const deletedIds: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of input.ids) {
    const numId = Number(id);
    if (!Number.isInteger(numId)) {
      failed.push({ id, error: `Invalid category id: ${id}` });
      continue;
    }
    try {
      await client.delete(`/products/categories/${numId}`, { force: true });
      deletedIds.push(id);
    } catch (err) {
      failed.push({ id, error: (err as Error).message || "delete failed" });
    }
  }
  return { deletedIds, failed };
}
