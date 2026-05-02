import type { SyncProvider, SyncProviderId } from "./types";
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
