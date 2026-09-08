import type { SupabaseClient } from "@supabase/supabase-js";
import type { MasterProductJson } from "@/lib/storage-helpers";

const UPSERT_CHUNK = 250;
const SKU_IN_CHUNK = 200;

type ProductRow = {
  workspace_id: string;
  sku: string;
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
  search_text: string;
  updated_at: string;
};

export function productSearchText(sku: string, data: Record<string, unknown>): string {
  const parts = [sku];
  for (const value of Object.values(data || {})) {
    if (value == null) continue;
    const text = String(value);
    if (text.startsWith("data:image")) continue;
    if (text.length > 240) continue;
    parts.push(text);
  }
  return parts.join(" ").toLowerCase();
}

export function extractProductColumns(products: MasterProductJson[]): string[] {
  const colSet = new Set<string>();
  for (const product of products) {
    if (!product.data) continue;
    for (const key of Object.keys(product.data)) colSet.add(key);
  }
  return Array.from(colSet);
}

export function rowToProduct(row: {
  sku: string;
  data?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}): MasterProductJson {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  return {
    sku: row.sku,
    data: (row.data ?? {}) as Record<string, unknown>,
    enrichedData: meta.enrichedData as MasterProductJson["enrichedData"],
    categoryId: typeof meta.categoryId === "string" ? meta.categoryId : undefined,
    status: typeof meta.status === "string" ? meta.status : undefined,
    createdAt: typeof meta.createdAt === "string" ? meta.createdAt : undefined,
  };
}

export function productToRow(
  workspaceId: string,
  product: MasterProductJson
): ProductRow {
  return {
    workspace_id: workspaceId,
    sku: product.sku,
    data: product.data ?? {},
    meta: {
      enrichedData: product.enrichedData ?? null,
      categoryId: product.categoryId ?? null,
      status: product.status ?? null,
      createdAt: product.createdAt ?? null,
    },
    search_text: productSearchText(product.sku, product.data ?? {}),
    updated_at: new Date().toISOString(),
  };
}

export async function countWorkspaceProducts(
  admin: SupabaseClient,
  workspaceId: string
): Promise<number> {
  const { count, error } = await admin
    .from("workspace_products")
    .select("sku", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadProductColumns(
  admin: SupabaseClient,
  workspaceId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from("workspace_product_columns")
    .select("columns")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const columns = (data as { columns?: string[] } | null)?.columns;
  return Array.isArray(columns) ? columns : [];
}

export function dedupeProductsBySku(
  products: MasterProductJson[]
): MasterProductJson[] {
  const map = new Map<string, MasterProductJson>();
  for (const p of products) {
    const sku = p.sku?.trim();
    if (sku) {
      map.set(sku, sku === p.sku ? p : { ...p, sku });
    }
  }
  return Array.from(map.values());
}

export async function replaceWorkspaceProducts(
  admin: SupabaseClient,
  workspaceId: string,
  products: MasterProductJson[]
): Promise<void> {
  const uniqueProducts = dedupeProductsBySku(products);
  const keepSkus = uniqueProducts.map((p) => p.sku);
  for (let i = 0; i < uniqueProducts.length; i += UPSERT_CHUNK) {
    const chunk = uniqueProducts
      .slice(i, i + UPSERT_CHUNK)
      .map((p) => productToRow(workspaceId, p));
    const { error } = await admin.from("workspace_products").upsert(chunk, {
      onConflict: "workspace_id,sku",
    });
    if (error) throw new Error(error.message);
  }
  const { error: pruneError } = await admin.rpc("delete_workspace_products_except", {
    p_workspace_id: workspaceId,
    p_keep_skus: keepSkus,
  });
  if (pruneError) throw new Error(pruneError.message);

  const columns = extractProductColumns(uniqueProducts);
  const { error: colError } = await admin.from("workspace_product_columns").upsert(
    {
      workspace_id: workspaceId,
      columns,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" }
  );
  if (colError) throw new Error(colError.message);
}

export async function deleteWorkspaceProductSkus(
  admin: SupabaseClient,
  workspaceId: string,
  skus: string[]
): Promise<void> {
  if (skus.length === 0) return;
  for (let i = 0; i < skus.length; i += SKU_IN_CHUNK) {
    const chunk = skus.slice(i, i + SKU_IN_CHUNK);
    const { error } = await admin
      .from("workspace_products")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("sku", chunk);
    if (error) throw new Error(error.message);
  }
}

export async function listWorkspaceProducts(params: {
  admin: SupabaseClient;
  workspaceId: string;
  limit: number;
  cursor?: string | null;
  search?: string | null;
}): Promise<{ items: MasterProductJson[]; nextCursor: string | null; hasMore: boolean }> {
  const limit = Math.min(Math.max(params.limit, 1), 100);
  let query = params.admin
    .from("workspace_products")
    .select("sku, data, meta")
    .eq("workspace_id", params.workspaceId)
    .order("sku", { ascending: true })
    .limit(limit + 1);

  if (params.cursor) {
    query = query.gt("sku", params.cursor);
  }
  const search = params.search?.trim();
  if (search) {
    const escaped = search.replace(/[%_\\]/g, "\\$&");
    query = query.ilike("search_text", `%${escaped.toLowerCase()}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    sku: string;
    data: Record<string, unknown>;
    meta: Record<string, unknown>;
  }>;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map(rowToProduct);
  const nextCursor = hasMore ? page[page.length - 1]?.sku ?? null : null;
  return { items, nextCursor, hasMore };
}

export async function countWorkspaceProductsMatching(params: {
  admin: SupabaseClient;
  workspaceId: string;
  search?: string | null;
}): Promise<number> {
  let query = params.admin
    .from("workspace_products")
    .select("sku", { count: "exact", head: true })
    .eq("workspace_id", params.workspaceId);
  const search = params.search?.trim();
  if (search) {
    const escaped = search.replace(/[%_\\]/g, "\\$&");
    query = query.ilike("search_text", `%${escaped.toLowerCase()}%`);
  }
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function upsertWorkspaceProducts(
  admin: SupabaseClient,
  workspaceId: string,
  products: MasterProductJson[]
): Promise<void> {
  const uniqueProducts = dedupeProductsBySku(products);
  for (let i = 0; i < uniqueProducts.length; i += UPSERT_CHUNK) {
    const chunk = uniqueProducts
      .slice(i, i + UPSERT_CHUNK)
      .map((p) => productToRow(workspaceId, p));
    const { error } = await admin.from("workspace_products").upsert(chunk, {
      onConflict: "workspace_id,sku",
    });
    if (error) throw new Error(error.message);
  }
}

export async function loadAllWorkspaceProducts(
  admin: SupabaseClient,
  workspaceId: string
): Promise<MasterProductJson[]> {
  const items: MasterProductJson[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await listWorkspaceProducts({
      admin,
      workspaceId,
      limit: 100,
      cursor,
    });
    items.push(...page.items);
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}
