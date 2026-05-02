import type { SyncProvider } from "../../core/types";
import { testShopifyConnection, normalizeShopifyStoreUrl } from "./auth";
import { fetchShopifyProductsSheet } from "./fetch-products";
import { applyShopifyChanges } from "./apply";

export const ShopifyProvider: SyncProvider = {
  id: "shopify",
  label: "Shopify",
  capabilities: {
    hasVariants: true,
    hasInventoryLevels: true,
    supportsBatch: false, // Shopify product API does not support multi-product batch
    batchLimit: 1,
    supportsBidirectionalSync: false,
  },
  configFields: [
    {
      key: "store_url",
      label: "Store URL",
      type: "url",
      placeholder: "your-store.myshopify.com",
      required: true,
      helpText: "Must be a valid .myshopify.com domain.",
    },
    {
      key: "admin_api_token",
      label: "Admin API Access Token",
      type: "password",
      placeholder: "shpat_...",
      required: true,
      helpText: "Generate from Shopify Admin → Apps → Develop apps → API credentials.",
    },
  ],
  async testConnection(config) {
    return testShopifyConnection(config);
  },
  buildSavePayload({ config, testResult }) {
    const adminApiToken = String(config?.admin_api_token ?? "").trim();
    return {
      baseUrl: testResult.baseUrl,
      config: {
        store_domain: testResult.metadata?.storeDomain,
        admin_api_token: adminApiToken,
      },
    };
  },
  async fetchProductsSheet(integration, options) {
    return fetchShopifyProductsSheet(integration, options);
  },
  async applyChanges(input) {
    return applyShopifyChanges(input);
  },
};

export { normalizeShopifyStoreUrl };
export { SHOPIFY_CORE_PRODUCT_COLUMNS } from "./columns";
