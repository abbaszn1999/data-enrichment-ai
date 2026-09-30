import type { CategoryItem } from "@/types";
import { loadCategoriesJsonServer } from "@/lib/storage-helpers-server";
import { buildCategoryItems } from "./items";

/** Columns whose runs read the workspace's category list. */
export const CATEGORY_AWARE_COLUMN_IDS = ["categories", "parentCategory", "internalLinks"] as const;

export function runUsesCategories(enabledColumns: string[]): boolean {
  return enabledColumns.some((id) => (CATEGORY_AWARE_COLUMN_IDS as readonly string[]).includes(id));
}

/**
 * The Categories tab as a job will see it, read on the server at start so a
 * run never depends on what the browser sent and a resumed run classifies
 * against the same list. Trimmed to what the agent reads: it is stored in the
 * job's settings.
 */
export async function loadCategorySnapshot(workspaceId: string): Promise<CategoryItem[]> {
  const raw = await loadCategoriesJsonServer(workspaceId);
  return buildCategoryItems(raw).map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    parentId: cat.parentId,
    fullPath: cat.fullPath,
  }));
}
