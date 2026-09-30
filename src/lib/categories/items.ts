import type { CategoryItem } from "@/types";
import type { CategoryJson } from "@/lib/storage-helpers";

/**
 * Stored categories -> the shape the app and the agent read: each with its
 * full " > " path. Safe against cycles and orphaned parents in imported data.
 */
export function buildCategoryItems(rawCategories: CategoryJson[]): CategoryItem[] {
  const byId = new Map<string, CategoryJson>();
  for (const cat of rawCategories) byId.set(cat.id, cat);

  const fullPath = (cat: CategoryJson): string => {
    const parts: string[] = [cat.name];
    const seen = new Set<string>([cat.id]);
    let current = cat;
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
      current = byId.get(current.parentId)!;
      seen.add(current.id);
      parts.unshift(current.name);
    }
    return parts.join(" > ");
  };

  return rawCategories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    parentId: cat.parentId ?? null,
    originalId: cat.originalId ?? null,
    parentName: cat.parentId ? byId.get(cat.parentId)?.name : undefined,
    fullPath: fullPath(cat),
    description: cat.description,
    sortOrder: cat.sortOrder,
    attributes: cat.attributes,
  })) as CategoryItem[];
}
