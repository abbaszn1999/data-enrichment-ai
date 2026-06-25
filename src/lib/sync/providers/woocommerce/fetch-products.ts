import type { FetchProductsOptions, IntegrationRecord, SyncSheet } from "../../core/types";
import { runWithConcurrency } from "../../core/batch-executor";
import { createWooClient } from "./client";
import { buildWooCommerceCoreProductsSheet } from "./normalize";

const PER_PAGE = 100; // WooCommerce hard max

// Guards for the "load all" path so a large catalog can't blow the serverless
// execution window. Mirrors the budgeted-pages approach used for Shopify.
const FETCH_BUDGET_MS = 20_000;
const MAX_PRODUCTS_WHEN_ALL = 2000;
const MAX_VARIATION_PAGES = 50;

export async function fetchWooCommerceProductsSheet(
  integration: IntegrationRecord,
  options: FetchProductsOptions = {}
): Promise<SyncSheet> {
  const client = createWooClient(integration);
  const startedAt = Date.now();
  const limit = options.limit ?? 50;
  const shouldLoadAll = limit <= 0;
  // Even on "load all" we cap to a sane ceiling to stay within the budget.
  const targetCount = shouldLoadAll ? MAX_PRODUCTS_WHEN_ALL : limit;

  const allProducts: any[] = [];
  let page = 1;
  let truncated = false;
  while (allProducts.length < targetCount) {
    if (Date.now() - startedAt > FETCH_BUDGET_MS) {
      truncated = true;
      break;
    }
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
    if (totalPages && page >= totalPages) {
      break;
    } else if (totalPages && page < totalPages && allProducts.length >= targetCount) {
      // Hit the ceiling before exhausting the catalog.
      truncated = true;
    }
    page += 1;
  }

  // For variable products, fetch variations (parallel, concurrency=3).
  const variableProducts = allProducts.filter((p) => p?.type === "variable");
  const variationResults = await runWithConcurrency(
    variableProducts,
    async (product) => {
      const variations: any[] = [];
      let varPage = 1;
      while (varPage <= MAX_VARIATION_PAGES) {
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

  const sheet = buildWooCommerceCoreProductsSheet({
    integrationName: integration.integration_name,
    products: allProducts.map((product) => ({
      product,
      variations: variationMap.get(product.id) ?? [],
    })),
  });
  if (truncated) sheet.truncated = true;
  return sheet;
}
