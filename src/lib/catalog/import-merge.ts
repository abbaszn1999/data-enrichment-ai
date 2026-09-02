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
  const existingMap = new Map<string, MasterProductJson>(
    params.existing.map((p) => [p.sku, p])
  );
  const products = [...params.existing];
  let imported = 0;
  let skipped = 0;
  let updated = 0;

  if (params.dupMode === "skip") {
    for (const p of params.incoming) {
      const sku = p.sku?.trim();
      if (!sku || existingMap.has(sku)) {
        skipped++;
      } else {
        const item = sku === p.sku ? p : { ...p, sku };
        products.push(item);
        existingMap.set(sku, item);
        imported++;
      }
    }
    return { products, imported, skipped, updated };
  }

  if (params.dupMode === "update") {
    const indexBySku = new Map<string, number>(
      products.map((p, i) => [p.sku, i])
    );
    for (const p of params.incoming) {
      const sku = p.sku?.trim();
      if (!sku) {
        skipped++;
        continue;
      }
      const idx = indexBySku.get(sku);
      if (idx !== undefined) {
        products[idx] = {
          ...products[idx],
          data: { ...products[idx].data, ...p.data },
        };
        updated++;
      } else {
        const item = sku === p.sku ? p : { ...p, sku };
        products.push(item);
        indexBySku.set(sku, products.length - 1);
        imported++;
      }
    }
    return { products, imported, skipped, updated };
  }

  // dupMode === "new"
  const existingSkus = new Set<string>(params.existing.map((p) => p.sku));
  for (const p of params.incoming) {
    const sku = p.sku?.trim();
    if (!sku) {
      skipped++;
      continue;
    }
    if (existingSkus.has(sku)) {
      let counter = 1;
      let newSku = `${sku}_dup_${counter}`;
      while (existingSkus.has(newSku)) {
        counter++;
        newSku = `${sku}_dup_${counter}`;
      }
      existingSkus.add(newSku);
      products.push({
        ...p,
        sku: newSku,
      });
    } else {
      existingSkus.add(sku);
      const item = sku === p.sku ? p : { ...p, sku };
      products.push(item);
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
  if (dupMode === "update" || dupMode === "skip") {
    const seen = new Set<string>();
    let count = 0;
    for (const p of incoming) {
      const sku = p.sku?.trim();
      if (sku && !existingSkus.has(sku) && !seen.has(sku)) {
        seen.add(sku);
        count++;
      }
    }
    return count;
  }
  return incoming.filter((p) => Boolean(p.sku?.trim())).length;
}
