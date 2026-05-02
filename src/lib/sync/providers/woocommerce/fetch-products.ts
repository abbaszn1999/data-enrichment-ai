import type { FetchProductsOptions, IntegrationRecord, SyncSheet } from "../../core/types";
import { runWithConcurrency } from "../../core/batch-executor";
import { createWooClient } from "./client";
import { buildWooCommerceCoreProductsSheet } from "./normalize";

const PER_PAGE = 100; // WooCommerce hard max

export async function fetchWooCommerceProductsSheet(
  integration: IntegrationRecord,
  options: FetchProductsOptions = {}
): Promise<SyncSheet> {
  const client = createWooClient(integration);
  const limit = options.limit ?? 50;
  const shouldLoadAll = limit <= 0;
  const targetCount = shouldLoadAll ? Number.POSITIVE_INFINITY : limit;

  const allProducts: any[] = [];
  let page = 1;
  while (allProducts.length < targetCount) {
    const remaining = targetCount - allProducts.length;
    const perPage = Math.min(PER_PAGE, Number.isFinite(remaining) ? remaining : PER_PAGE);
    const response = await client.requestRaw("/products", {
      method: "GET",
      query: { per_page: perPage, page, status: "any" },
    });
    const products = (await response.json().catch(() => [])) as any[];
    if (!Array.isArray(products) || products.length === 0) break;
    allProducts.push(...products);

    const totalPagesHeader = response.headers.get("x-wp-totalpages") || response.headers.get("X-WP-TotalPages");
    const totalPages = totalPagesHeader ? Number(totalPagesHeader) : null;
    if (products.length < perPage) break;
    if (totalPages && page >= totalPages) break;
    page += 1;
  }

  // For variable products, fetch variations (parallel, concurrency=3).
  const variableProducts = allProducts.filter((p) => p?.type === "variable");
  const variationResults = await runWithConcurrency(
    variableProducts,
    async (product) => {
      const variations: any[] = [];
      let varPage = 1;
      while (true) {
        const resp = await client.requestRaw(`/products/${product.id}/variations`, {
          method: "GET",
          query: { per_page: PER_PAGE, page: varPage },
        });
        const list = (await resp.json().catch(() => [])) as any[];
        if (!Array.isArray(list) || list.length === 0) break;
        variations.push(...list);
        if (list.length < PER_PAGE) break;
        varPage += 1;
      }
      return { productId: product.id, variations };
    },
    { concurrency: 3, delayMsBetweenBatches: 250 }
  );

  const variationMap = new Map<number, any[]>();
  for (const r of variationResults.successes) {
    variationMap.set(r.productId, r.variations);
  }

  return buildWooCommerceCoreProductsSheet({
    integrationName: integration.integration_name,
    products: allProducts.map((product) => ({
      product,
      variations: variationMap.get(product.id) ?? [],
    })),
  });
}
