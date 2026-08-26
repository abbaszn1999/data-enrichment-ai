import type {
  DetectedProduct,
  IntegrationRecord,
  ResolvedTaxonomy,
  SyncSheet,
  SyncSheetRow,
  TaxonomySummary,
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
  /** Storefront category URL. Present on live WooCommerce responses even
   *  though it isn't listed in the official schema docs. */
  link?: string;
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

/**
 * Remove products from a WooCommerce category.
 *
 * WooCommerce has no "remove from category" endpoint: categories live on the
 * product as a whole array, and a write replaces it. So the product's current
 * categories are read and written back minus the one being removed — dropping
 * that read would silently wipe every other category the product belongs to.
 */
export async function unassignProductsFromWooCategory(input: {
  integration: IntegrationRecord;
  categoryId: string;
  productIds: string[];
}): Promise<{ removedCount: number }> {
  const client = createWooClient(input.integration);
  const catId = Number(input.categoryId);
  if (!Number.isInteger(catId)) {
    throw new ValidationError(`Invalid WooCommerce category id: ${input.categoryId}`, {
      provider: "woocommerce",
    });
  }
  const ids = input.productIds.map(Number).filter((n) => Number.isInteger(n));
  if (ids.length === 0) return { removedCount: 0 };

  let removedCount = 0;
  for (const idChunk of chunk(ids, 100)) {
    const products = await client.get<Array<{ id: number; categories?: Array<{ id: number }> }>>(
      "/products",
      { include: idChunk.join(","), per_page: 100 }
    );
    const update: Array<{ id: number; categories: Array<{ id: number }> }> = [];
    for (const p of Array.isArray(products) ? products : []) {
      const current = (p.categories ?? [])
        .map((c) => c.id)
        .filter((n) => Number.isInteger(n));
      if (!current.includes(catId)) continue; // already absent
      update.push({
        id: p.id,
        categories: current.filter((cid) => cid !== catId).map((cid) => ({ id: cid })),
      });
    }
    if (update.length === 0) continue;
    await client.post("/products/batch", { update });
    removedCount += update.length;
  }
  return { removedCount };
}

/** Every product category in the store, walked page by page. */
export async function listAllWooCategories(input: {
  integration: IntegrationRecord;
  max?: number;
}): Promise<TaxonomySummary[]> {
  const client = createWooClient(input.integration);
  const max = input.max ?? 5000;
  const out: TaxonomySummary[] = [];
  let page = 1;

  while (out.length < max) {
    const response = await client.get<WooCategory[]>("/products/categories", {
      per_page: 100,
      page,
      hide_empty: false,
      orderby: "name",
      order: "asc",
    });
    if (!Array.isArray(response) || response.length === 0) break;
    for (const category of response) {
      if (!category.id) continue;
      out.push({
        id: String(category.id),
        title: category.name ?? "",
        handle: category.slug,
        productCount: category.count ?? 0,
        // WooCommerce categories are always hand-editable; it has no notion of
        // a rule-driven category the API refuses to write to.
        manual: true,
        parent: category.parent && category.parent > 0 ? String(category.parent) : undefined,
        url: category.link || undefined,
      });
    }
    if (response.length < 100) break;
    page += 1;
  }
  return out;
}

/**
 * Products created after `since` inside one category, newest first.
 *
 * Unlike Shopify, WooCommerce filters by creation date server-side, so this is
 * a single request that returns only new products — no walking, no watermark
 * comparison in application code.
 *
 * Docs: https://developer.woocommerce.com/docs/apis/rest-api/v3/products/
 */
export async function detectNewWooCategoryProducts(input: {
  integration: IntegrationRecord;
  categoryId: string;
  since: string | null;
  maxPages?: number;
}): Promise<{
  products: DetectedProduct[];
  newestCreatedAt: string | null;
  truncated?: boolean;
}> {
  // A fresh rule owns the future only; without this guard the first tick would
  // pull the entire category.
  if (!input.since) return { products: [], newestCreatedAt: null };

  const client = createWooClient(input.integration);
  const catId = Number(input.categoryId);
  if (!Number.isInteger(catId)) {
    throw new ValidationError(`Invalid WooCommerce category id: ${input.categoryId}`, {
      provider: "woocommerce",
    });
  }

  // Generous on purpose: `after` already narrows the set to new products, so
  // the ceiling only guards against a bulk import turning one detection into an
  // unbounded crawl.
  const maxPages = Math.max(input.maxPages ?? 20, 1);
  const products: DetectedProduct[] = [];
  let page = 1;
  let sawFullPage = false;

  while (page <= maxPages) {
    const response = await client.get<
      Array<{
        id?: number;
        name?: string;
        permalink?: string;
        date_created_gmt?: string;
        date_created?: string;
        type?: string;
        description?: string;
        short_description?: string;
        tags?: Array<{ name?: string }>;
        images?: Array<{ src?: string }>;
      }>
    >("/products", {
      category: catId,
      // `after` is compared against the creation date; the GMT flag keeps it
      // aligned with the ISO watermark instead of the store's local timezone.
      after: input.since,
      dates_are_gmt: true,
      // `after` already narrows the set, but the ordering is what makes the
      // first element the newest, which is how the watermark advances.
      orderby: "date",
      order: "desc",
      per_page: 100,
      page,
      status: "any",
    });
    if (!Array.isArray(response) || response.length === 0) break;

    for (const p of response) {
      if (!p.id) continue;
      const createdAt = p.date_created_gmt
        ? `${p.date_created_gmt}Z`
        : (p.date_created ?? "");
      products.push({
        id: String(p.id),
        title: p.name ?? "",
        createdAt,
        url: p.permalink,
        imageUrl: p.images?.[0]?.src,
        productType: p.type ?? undefined,
        tags: p.tags?.map((t) => t.name ?? "").filter(Boolean),
        description: p.short_description || p.description || undefined,
      });
    }

    sawFullPage = response.length >= 100;
    if (!sawFullPage) break;
    page += 1;
  }

  return {
    products,
    newestCreatedAt: products[0]?.createdAt ?? null,
    truncated: sawFullPage && page > maxPages ? true : undefined,
  };
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
