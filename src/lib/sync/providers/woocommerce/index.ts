import type { SyncProvider } from "../../core/types";
import { testWooCommerceConnection, normalizeWooCommerceStoreUrl } from "./auth";
import { fetchWooCommerceProductsSheet } from "./fetch-products";
import { applyWooCommerceChanges } from "./apply";
import {
  resolveWooCategoryByName,
  assignProductsToWooCategory,
  unassignProductsFromWooCategory,
  deleteWooCategories,
  listAllWooCategories,
  detectNewWooCategoryProducts,
} from "./categories";
import { WOOCOMMERCE_CORE_PRODUCT_COLUMNS } from "./columns";
import {
  WOOCOMMERCE_WRITABLE_COLUMNS,
  WOOCOMMERCE_COLUMN_PROFILES,
  WOOCOMMERCE_SERVER_FILTER_KEYS,
  WOOCOMMERCE_CLIENT_PREDICATE_KINDS,
} from "./schema-catalog";

export const WooCommerceProvider: SyncProvider = {
  id: "woocommerce",
  label: "WooCommerce",
  capabilities: {
    hasVariants: true,
    hasInventoryLevels: false,
    supportsBatch: true,
    batchLimit: 100,
    supportsBidirectionalSync: false,
  },
  schema: {
    coreColumns: WOOCOMMERCE_CORE_PRODUCT_COLUMNS,
    writableColumns: WOOCOMMERCE_WRITABLE_COLUMNS,
    columnProfiles: WOOCOMMERCE_COLUMN_PROFILES,
    serverFilterKeys: WOOCOMMERCE_SERVER_FILTER_KEYS,
    clientPredicateKinds: WOOCOMMERCE_CLIENT_PREDICATE_KINDS,
    taxonomyLabel: "Categories",
  },
  taxonomy: {
    resolve: ({ integration, name }) => resolveWooCategoryByName({ integration, name }),
    assign: ({ integration, taxonomyId, productIds }) =>
      assignProductsToWooCategory({ integration, categoryId: taxonomyId, productIds }),
    delete: ({ integration, ids }) => deleteWooCategories({ integration, ids }),
    list: ({ integration, max }) => listAllWooCategories({ integration, max }),
    unassign: ({ integration, taxonomyId, productIds }) =>
      unassignProductsFromWooCategory({ integration, categoryId: taxonomyId, productIds }),
  },
  growthSync: {
    detectNewProducts: ({ integration, taxonomyId, since, maxPages }) =>
      detectNewWooCategoryProducts({
        integration,
        categoryId: taxonomyId,
        since,
        maxPages,
      }),
  },
  configFields: [
    {
      key: "store_url",
      label: "Store URL",
      type: "url",
      placeholder: "https://your-store.com",
      required: true,
      helpText: "Your WordPress site URL where WooCommerce is installed.",
    },
    {
      key: "username",
      label: "WordPress Username",
      type: "text",
      placeholder: "admin",
      required: true,
      helpText: "Your WordPress admin username.",
    },
    {
      key: "application_password",
      label: "WordPress Application Password",
      type: "password",
      placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx",
      required: true,
      helpText: "Generate from WordPress → Users → Profile → Application Passwords. Do not use your normal login password.",
    },
  ],
  async testConnection(config) {
    return testWooCommerceConnection(config);
  },
  buildSavePayload({ config, testResult }) {
    return {
      baseUrl: testResult.baseUrl,
      config: {
        store_domain: testResult.metadata?.storeDomain,
        store_name: testResult.metadata?.storeName ?? null,
        currency: testResult.metadata?.currency ?? null,
        wc_version: testResult.metadata?.wcVersion ?? null,
        username: String(config?.username ?? "").trim(),
        application_password: String(config?.application_password ?? "").trim(),
        api_version: "wc/v3",
      },
    };
  },
  async fetchProductsSheet(integration, options) {
    return fetchWooCommerceProductsSheet(integration, options);
  },
  async applyChanges(input) {
    return applyWooCommerceChanges(input);
  },
};

export { normalizeWooCommerceStoreUrl };
export { WOOCOMMERCE_CORE_PRODUCT_COLUMNS } from "./columns";
export {
  WOOCOMMERCE_API_VERSION,
  WOOCOMMERCE_COLUMN_PROFILES,
  WOOCOMMERCE_LIMITS,
  WOOCOMMERCE_WRITABLE_COLUMNS,
} from "./schema-catalog";
