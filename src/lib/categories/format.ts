import type { CategoryFormat } from "@/types";

/**
 * How a platform stores categories:
 * - "flat": a list of names with no parents (Shopify collections)
 * - "tree": categories with parents, any depth (WooCommerce and the rest)
 */
export type CategoryStructure = "flat" | "tree";

export function categoryStructureFor(cmsType: string | null | undefined): CategoryStructure {
  return (cmsType || "shopify").toLowerCase() === "shopify" ? "flat" : "tree";
}

export interface CategoryFormatOption {
  id: CategoryFormat;
  label: string;
  example: string;
  /** Deepest path the agent may write (1 = names only). */
  depth: number;
}

const FORMAT_OPTIONS: Record<CategoryFormat, CategoryFormatOption> = {
  collections: { id: "collections", label: "Collections", example: "Summer Sale, New Arrivals", depth: 1 },
  flat: { id: "flat", label: "Flat list", example: "Shoes, Sneakers", depth: 1 },
  depth2: { id: "depth2", label: "Category > Sub category", example: "Shoes > Sneakers", depth: 2 },
  depth3: {
    id: "depth3",
    label: "Category > Sub > Sub sub",
    example: "Shoes > Sneakers > Running",
    depth: 3,
  },
};

/** The formats a platform can take when the agent has to suggest categories. */
export function categoryFormatsFor(cmsType: string | null | undefined): CategoryFormatOption[] {
  return categoryStructureFor(cmsType) === "flat"
    ? [FORMAT_OPTIONS.collections]
    : [FORMAT_OPTIONS.flat, FORMAT_OPTIONS.depth2, FORMAT_OPTIONS.depth3];
}

export function defaultCategoryFormat(cmsType: string | null | undefined): CategoryFormat {
  return categoryStructureFor(cmsType) === "flat" ? "collections" : "depth2";
}

/** A saved format may not fit the platform any more (the platform was switched); fall back to the default. */
export function resolveCategoryFormat(
  cmsType: string | null | undefined,
  requested: CategoryFormat | string | null | undefined
): CategoryFormat {
  const allowed = categoryFormatsFor(cmsType);
  return allowed.find((option) => option.id === requested)?.id ?? defaultCategoryFormat(cmsType);
}

export function categoryFormatDepth(format: CategoryFormat): number {
  return FORMAT_OPTIONS[format].depth;
}

/** Label of the "how many per product" control. */
export function categoryCountLabel(format: CategoryFormat, useStoreCategories: boolean): string {
  if (useStoreCategories) return "Max categories per product";
  if (format === "collections") return "Collections per product";
  if (format === "flat") return "Categories per product";
  return "Paths per product";
}
