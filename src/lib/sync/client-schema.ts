// Client-safe provider schema.
//
// The full provider registry (core/registry.ts) pulls in server-only code
// (GraphQL clients, fetch helpers, node crypto, …) so it cannot be imported
// into a browser bundle. The UI still needs the per-provider column profiles
// and taxonomy label to render the right sheet tabs.
//
// This module imports ONLY the pure constant files (schema-catalog.ts) from
// each provider, which contain no server dependencies, and exposes a tiny
// lookup the client can safely use. Adding a new CMS = add a branch here that
// points at that provider's pure schema-catalog constants.

import {
  COLUMN_PROFILES as SHOPIFY_COLUMN_PROFILES,
} from "./providers/shopify/schema-catalog";
import {
  WOOCOMMERCE_COLUMN_PROFILES,
} from "./providers/woocommerce/schema-catalog";

export type ClientProviderSchema = {
  columnProfiles: Record<string, string[]>;
  taxonomyLabel: string;
};

const SHOPIFY: ClientProviderSchema = {
  columnProfiles: SHOPIFY_COLUMN_PROFILES,
  taxonomyLabel: "Collections",
};

const WOOCOMMERCE: ClientProviderSchema = {
  columnProfiles: WOOCOMMERCE_COLUMN_PROFILES,
  taxonomyLabel: "Categories",
};

/**
 * Resolve the client-side schema for a connected provider. Falls back to
 * Shopify's shape for unknown / missing providers (the UI was historically
 * Shopify-shaped, so this preserves prior behavior).
 */
export function getClientProviderSchema(
  providerId?: string | null
): ClientProviderSchema {
  switch (providerId) {
    case "woocommerce":
      return WOOCOMMERCE;
    case "shopify":
    default:
      return SHOPIFY;
  }
}
