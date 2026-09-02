import type { MasterProductJson } from "@/lib/storage-helpers";

export type ProductDupMode = "skip" | "update" | "new";

export function mergeImportedProducts(params: {
  existing: MasterProductJson[];
  incoming: MasterProductJson[];
  dupMode: ProductDupMode;
}): {
  products: MasterProductJson[];
  imported: number;
  skipped: number;
  updated: number;
} {
  const existingMap = new Map(params.existing.map((p) => [p.sku, p]));
  const products = [...params.existing];
  let imported = 0;
  let skipped = 0;
  let updated = 0;

  if (params.dupMode === "skip") {
    for (const p of params.incoming) {
      if (existingMap.has(p.sku)) {
        skipped++;
      } else {
        products.push(p);
        imported++;
      }
    }
    return { products, imported, skipped, updated };
  }

  if (params.dupMode === "update") {
    const indexBySku = new Map(products.map((p, i) => [p.sku, i]));
    for (const p of params.incoming) {
      const idx = indexBySku.get(p.sku);
      if (idx !== undefined) {
        products[idx] = {
          ...products[idx],
          data: { ...products[idx].data, ...p.data },
        };
        updated++;
      } else {
        products.push(p);
        indexBySku.set(p.sku, products.length - 1);
        imported++;
      }
    }
    return { products, imported, skipped, updated };
  }

  for (const p of params.incoming) {
    if (existingMap.has(p.sku)) {
      products.push({
        ...p,
        sku: `${p.sku}_dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      });
    } else {
      products.push(p);
      existingMap.set(p.sku, p);
    }
    imported++;
  }
  return { products, imported, skipped, updated };
}

export function incomingQuotaDelta(
  existingSkus: Set<string>,
  incoming: MasterProductJson[],
  dupMode: ProductDupMode
): number {
  if (dupMode === "update") {
    return incoming.filter((p) => !existingSkus.has(p.sku)).length;
  }
  if (dupMode === "skip") {
    return incoming.filter((p) => !existingSkus.has(p.sku)).length;
  }
  return incoming.length;
}
