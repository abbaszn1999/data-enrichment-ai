import type { MarketResearchProduct } from "@/components/market-research/workspace-data";

export const MAX_PRODUCT_LIST_IDS = 500;

export function parseProductIdQuery(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_PRODUCT_LIST_IDS) break;
  }
  return ids;
}

export function selectProductsByIds(
  products: MarketResearchProduct[],
  ids: string[]
): MarketResearchProduct[] {
  if (ids.length === 0) return products;
  const want = new Set(ids.slice(0, MAX_PRODUCT_LIST_IDS));
  const out: MarketResearchProduct[] = [];
  for (const product of products) {
    if (!want.has(product.id)) continue;
    out.push(product);
    want.delete(product.id);
    if (want.size === 0) break;
  }
  return out;
}
