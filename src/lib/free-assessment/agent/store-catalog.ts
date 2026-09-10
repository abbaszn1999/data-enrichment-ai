/**
 * Catalog item shape shared by the cloned Stage 1 agents.
 * Free assessment fills this from the uploaded PLP sheet, not a live store.
 */
export type StoreCollectionItem = {
  id: string;
  name: string;
  handle: string;
  description: string;
  productCount: number;
  plpPath: string;
  published?: boolean;
  parentId?: string;
  depth?: number;
  kind?: "collection" | "brand";
};

export type StoreCatalogResult = {
  storeName: string;
  provider: string;
  baseUrl: string;
  isMock: boolean;
  collections: StoreCollectionItem[];
  storeBrands: StoreCollectionItem[];
};
