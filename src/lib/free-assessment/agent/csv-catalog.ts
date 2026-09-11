import type { StoreCollectionItem } from "./store-catalog";

export type UploadedPlpRow = {
  name: string;
  pageType: "collection" | "category" | "brand";
  skuCount: number;
  description?: string;
};

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "plp"
  );
}

/**
 * Turns the uploaded PLP sheet into the same `StoreCollectionItem[]` shape
 * the cloned Stage 1/3 agents expect from a live store. Free Assessment has
 * no live catalog — this list of rows IS the catalog, so every row maps
 * 1:1 onto a flat (no parent/depth hierarchy) collection or brand item.
 */
export function csvRowsToCollectionItems(
  rows: UploadedPlpRow[]
): { collections: StoreCollectionItem[]; brands: StoreCollectionItem[] } {
  const collections: StoreCollectionItem[] = [];
  const brands: StoreCollectionItem[] = [];
  const usedIds = new Set<string>();

  rows.forEach((row, index) => {
    let id = slugify(row.name);
    let n = 2;
    while (usedIds.has(id)) {
      id = `${slugify(row.name)}-${n}`;
      n += 1;
    }
    usedIds.add(id);

    const item: StoreCollectionItem = {
      id,
      name: row.name,
      handle: id,
      description: row.description?.trim() || "",
      productCount: Math.max(0, Math.floor(row.skuCount)),
      plpPath: "",
      depth: 0,
      kind: row.pageType === "brand" ? "brand" : "collection",
    };

    if (row.pageType === "brand") {
      brands.push(item);
    } else {
      collections.push(item);
    }
    void index;
  });

  return { collections, brands };
}
