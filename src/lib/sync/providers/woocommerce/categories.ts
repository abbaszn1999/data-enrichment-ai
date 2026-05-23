import type { IntegrationRecord, SyncSheet, SyncSheetRow } from "@/lib/sync/core/types";
import { createWooClient } from "./client";

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
