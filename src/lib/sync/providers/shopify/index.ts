import type { SyncProvider } from "../../core/types";
import { testShopifyConnection, normalizeShopifyStoreUrl } from "./auth";
import { fetchShopifyProductsSheet } from "./fetch-products";
import { applyShopifyChanges } from "./apply";
import {
  resolveCollectionByName,
  assignProductsToCollection,
  deleteShopifyCollection,
} from "./collections";
import { SHOPIFY_CORE_PRODUCT_COLUMNS } from "./columns";
import {
  WRITABLE_COLUMNS,
  COLUMN_PROFILES,
  SERVER_FILTER_KEYS,
  CLIENT_PREDICATE_KINDS,
} from "./schema-catalog";

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
  schema: {
    coreColumns: SHOPIFY_CORE_PRODUCT_COLUMNS,
    writableColumns: WRITABLE_COLUMNS,
    columnProfiles: COLUMN_PROFILES,
    serverFilterKeys: SERVER_FILTER_KEYS,
    clientPredicateKinds: CLIENT_PREDICATE_KINDS,
    taxonomyLabel: "Collections",
  },
  taxonomy: {
    async resolve({ integration, name }) {
      const r = await resolveCollectionByName({ integration, name });
      return r ? { id: r.id, handle: r.handle, title: r.title } : null;
    },
    async assign({ integration, taxonomyId, productIds }) {
      const { assignedCount, newTotal } = await assignProductsToCollection({
        integration,
        collectionId: taxonomyId,
        productIds,
      });
      return { assignedCount, newTotal: newTotal ?? undefined };
    },
    async delete({ integration, ids }) {
      const deletedIds: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const id of ids) {
        try {
          const { deletedId } = await deleteShopifyCollection({ integration, collectionId: id });
          deletedIds.push(deletedId);
        } catch (err) {
          failed.push({ id, error: (err as Error).message || "delete failed" });
        }
      }
      return { deletedIds, failed };
    },
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
