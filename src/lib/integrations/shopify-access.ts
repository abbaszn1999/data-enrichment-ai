/**
 * The Shopify access scopes each tool needs, shown in Settings so a merchant
 * knows what to enable on their app, and checked against the scopes the token
 * really has. Keep in step with the code each tool runs (the Store Agent's own
 * list is checked against this one in its tests).
 */

export type StoreToolId = "store-assistant" | "growth-sync" | "market-research" | "website-restructure";

export type ShopifyToolAccess = {
  id: StoreToolId;
  name: string;
  /** What the tool does on the store, in a sentence. */
  summary: string;
  scopes: readonly string[];
  /**
   * What it needs to open, when less than all of `scopes`: the Store Assistant
   * opens with read_products, and each other scope adds what it can do.
   * Without this, every scope is needed (the tool runs fixed steps that use them all).
   */
  required?: readonly string[];
};

export const SHOPIFY_TOOL_ACCESS: readonly ShopifyToolAccess[] = [
  {
    id: "store-assistant",
    name: "Store Assistant",
    summary: "Reads and edits products, variants, collections, inventory, images and where products are published.",
    required: ["read_products"],
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

/** The scopes a tool cannot open without. */
export const requiredShopifyScopes = (tool: ShopifyToolAccess): readonly string[] => tool.required ?? tool.scopes;

/** Why a tool is locked, or null when it opens. */
export type ToolLock = { reason: "no-store" } | { reason: "unsupported-store" } | { reason: "missing-scopes"; missing: string[] } | null;

/** Platforms the Store Assistant works with. */
const STORE_AGENT_PROVIDERS = new Set(["shopify", "woocommerce"]);

/**
 * Which store tools open for this workspace. Shopify tools need the scopes
 * they use (the Store Assistant only read_products); when the scopes are not
 * known yet (null), nothing is locked for them: the tools still say what is
 * missing when they run. WooCommerce has no scopes: its tools open.
 */
export function storeToolLocks(provider: string | null | undefined, grantedScopes: readonly string[] | null | undefined): Record<StoreToolId, ToolLock> {
  const locks = {} as Record<StoreToolId, ToolLock>;
  for (const tool of SHOPIFY_TOOL_ACCESS) {
    if (!provider) locks[tool.id] = { reason: "no-store" };
    else if (tool.id === "store-assistant" && !STORE_AGENT_PROVIDERS.has(provider)) locks[tool.id] = { reason: "unsupported-store" };
    else if (provider === "shopify" && Array.isArray(grantedScopes)) {
      const missing = missingShopifyScopes(grantedScopes, requiredShopifyScopes(tool));
      locks[tool.id] = missing.length ? { reason: "missing-scopes", missing } : null;
    } else locks[tool.id] = null;
  }
  return locks;
}
