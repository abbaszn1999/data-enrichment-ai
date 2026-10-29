/** Store platforms the Store Agent works with. A WordPress site without WooCommerce is not one. */
export const STORE_AGENT_PLATFORMS = ["shopify", "woocommerce"] as const;

export function isStoreAgentPlatform(provider: string | null | undefined): provider is (typeof STORE_AGENT_PLATFORMS)[number] {
  return (STORE_AGENT_PLATFORMS as readonly string[]).includes(provider ?? "");
}
