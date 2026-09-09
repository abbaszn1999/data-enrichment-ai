import type { StoreCollectionItem } from "./store-catalog";

export const STAGE1_MAX_COLLECTIONS = 150;

export function compressCollectionsForStage1(collections: StoreCollectionItem[]): {
  kept: Array<{
    id: string;
    name: string;
    productCount: number;
    description?: string;
    // WooCommerce hierarchy only — undefined/omitted for Shopify's flat collections
    // and always omitted for brand items, which never have a parent category.
    parentId?: string;
    depth?: number;
    // Present only on brand/vendor PLPs — every other item omits this key.
    kind?: "brand";
  }>;
  overflowCount: number;
  overflowProducts: number;
} {
  const sorted = [...collections].sort((a, b) => b.productCount - a.productCount);
  const keptSource = sorted.slice(0, STAGE1_MAX_COLLECTIONS);
  const overflow = sorted.slice(STAGE1_MAX_COLLECTIONS);
  return {
    kept: keptSource.map((c) => ({
      id: c.id,
      name: c.name,
      productCount: c.productCount,
      description: c.description || undefined,
      parentId: c.parentId && c.parentId !== "0" ? c.parentId : undefined,
      depth: c.depth ?? 0,
      kind: c.kind === "brand" ? ("brand" as const) : undefined,
    })),
    overflowCount: overflow.length,
    overflowProducts: overflow.reduce((sum, c) => sum + (c.productCount || 0), 0),
  };
}
