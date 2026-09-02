import type { StoreCollectionItem } from "./store-catalog";

export const STAGE1_MAX_COLLECTIONS = 150;

export function compressCollectionsForStage1(collections: StoreCollectionItem[]): {
  kept: Array<{
    id: string;
    name: string;
    productCount: number;
    description?: string;
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
    })),
    overflowCount: overflow.length,
    overflowProducts: overflow.reduce((sum, c) => sum + (c.productCount || 0), 0),
  };
}
