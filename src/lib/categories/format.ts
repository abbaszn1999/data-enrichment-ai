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

/** The formats a platform's own category list is shaped like. */
export function categoryFormatsFor(cmsType: string | null | undefined): CategoryFormatOption[] {
  return categoryStructureFor(cmsType) === "flat"
    ? [FORMAT_OPTIONS.collections]
    : [FORMAT_OPTIONS.flat, FORMAT_OPTIONS.depth2, FORMAT_OPTIONS.depth3];
}

/**
 * Every format the user can pick when the AI suggests its own categories
 * ("Use my store categories" off). It is the user's choice, whatever the
 * platform.
 */
export const SUGGEST_CATEGORY_FORMATS: CategoryFormatOption[] = [
  FORMAT_OPTIONS.collections,
  FORMAT_OPTIONS.flat,
  FORMAT_OPTIONS.depth2,
  FORMAT_OPTIONS.depth3,
];

export function categoryFormatOption(format: CategoryFormat): CategoryFormatOption {
  return FORMAT_OPTIONS[format];
}

export function defaultCategoryFormat(cmsType: string | null | undefined): CategoryFormat {
  return categoryStructureFor(cmsType) === "flat" ? "collections" : "depth2";
}

/**
 * The format a run uses when the AI suggests categories: the user's choice
 * when it is one we know (any platform may pick any format), otherwise the
 * platform's default. Store-list runs ignore it.
 */
export function resolveCategoryFormat(
  cmsType: string | null | undefined,
  requested: CategoryFormat | string | null | undefined
): CategoryFormat {
  return SUGGEST_CATEGORY_FORMATS.find((option) => option.id === requested)?.id ?? defaultCategoryFormat(cmsType);
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
