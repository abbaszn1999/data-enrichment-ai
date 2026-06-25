import type { ProviderSchema, SyncProvider, SyncProviderId } from "./types";
import { ShopifyProvider } from "../providers/shopify";
import { WooCommerceProvider } from "../providers/woocommerce";

export const PROVIDERS: Record<string, SyncProvider> = {
  shopify: ShopifyProvider,
  woocommerce: WooCommerceProvider,
};

export function getProvider(id: SyncProviderId): SyncProvider {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Unsupported sync provider: ${id}`);
  }
  return provider;
}

export function listProviders(): SyncProvider[] {
  return Object.values(PROVIDERS);
}

export function isProviderSupported(id: string): id is SyncProviderId {
  return id in PROVIDERS;
}

/**
 * Resolve a provider's schema. Falls back to Shopify's schema for unknown /
 * missing providers so callers always get a usable vocabulary (the agent UI
 * was historically Shopify-shaped, so this preserves prior behavior).
 */
export function getProviderSchema(id: SyncProviderId | null | undefined): ProviderSchema {
  if (id && PROVIDERS[id]) return PROVIDERS[id].schema;
  return ShopifyProvider.schema;
}

/**
 * Union of every registered provider's writable columns. Used to build the
 * tool catalog's `targetColumn` enum so a column writable on ANY provider
 * validates — the per-provider system prompt steers the model to the right
 * subset. Adding a new provider automatically widens this set.
 */
export function getAllWritableColumns(): string[] {
  const set = new Set<string>();
  for (const provider of Object.values(PROVIDERS)) {
    for (const col of provider.schema.writableColumns) set.add(col);
  }
  return Array.from(set);
}

/**
 * Union of every registered provider's column-profile keys (UI tabs). Used to
 * build the tool catalog's `columnProfile` enum so a profile valid on ANY
 * provider validates — the per-provider system prompt steers the model to the
 * right subset. Adding a new provider automatically widens this set.
 */
export function getAllColumnProfileKeys(): string[] {
  const set = new Set<string>();
  for (const provider of Object.values(PROVIDERS)) {
    for (const key of Object.keys(provider.schema.columnProfiles)) set.add(key);
  }
  return Array.from(set);
}
