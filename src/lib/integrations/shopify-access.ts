/**
 * The Shopify access scopes each tool needs, shown in Settings so a merchant
 * knows what to enable on their app, and checked against the scopes the token
 * really has. Keep in step with the code each tool runs (the Store Agent's own
 * list is checked against this one in its tests).
 */

export type ShopifyToolAccess = {
  id: string;
  name: string;
  /** What the tool does on the store, in a sentence. */
  summary: string;
  scopes: readonly string[];
};

export const SHOPIFY_TOOL_ACCESS: readonly ShopifyToolAccess[] = [
  {
    id: "store-assistant",
    name: "Store Assistant",
    summary: "Reads and edits products, variants, collections, inventory, images and where products are published.",
    scopes: [
      "read_products",
      "write_products",
      "read_inventory",
      "write_inventory",
      "read_locations",
      "write_locations",
      "read_files",
      "write_files",
      "read_publications",
      "write_publications",
    ],
  },
  {
    id: "growth-sync",
    name: "Growth Sync",
    summary: "Finds new products, creates collections, adds and removes products, and deletes collections it made.",
    scopes: ["read_products", "write_products"],
  },
  {
    id: "market-research",
    name: "Market Research",
    summary: "Reads products, collections and brands, creates collections with SEO and publishes them, and writes blog articles.",
    scopes: ["read_products", "write_products", "read_publications", "write_publications", "read_content", "write_content"],
  },
  {
    id: "website-restructure",
    name: "Website Restructure",
    summary: "Read only: your navigation menus, collections and brands.",
    scopes: ["read_online_store_navigation", "read_products"],
  },
];

/** Every scope the platform uses, in a stable order, for "copy all". */
export const ALL_SHOPIFY_SCOPES: readonly string[] = [...new Set(SHOPIFY_TOOL_ACCESS.flatMap((t) => t.scopes))];

/** Shopify grants read access with every write scope. */
export function hasShopifyScope(granted: ReadonlySet<string>, scope: string): boolean {
  return granted.has(scope) || (scope.startsWith("read_") && granted.has(scope.replace(/^read_/, "write_")));
}

export function missingShopifyScopes(granted: readonly string[], scopes: readonly string[]): string[] {
  const set = new Set(granted);
  return scopes.filter((s) => !hasShopifyScope(set, s));
}
