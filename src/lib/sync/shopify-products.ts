// Backward-compatibility shim. New code should import from "@/lib/sync".
export type { SyncSheet, SyncSheetRow } from "./core/types";
export { buildShopifyCoreProductsSheet, normalizeShopifyProductRow } from "./providers/shopify/normalize";
export { SHOPIFY_CORE_PRODUCT_COLUMNS } from "./providers/shopify/columns";
