import type { ProviderTestResult } from "../../core/types";

export function normalizeShopifyStoreUrl(input: string) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    throw new Error("Store URL is required");
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  const hostname = url.hostname.toLowerCase();
  if (!hostname.endsWith(".myshopify.com")) {
    throw new Error("Store URL must be a valid .myshopify.com domain");
  }
  return { storeUrl: `https://${hostname}`, storeDomain: hostname };
}

export async function testShopifyConnection(config: Record<string, any>): Promise<ProviderTestResult> {
  const { storeUrl: normalizedStoreUrl, storeDomain } = normalizeShopifyStoreUrl(String(config?.store_url ?? ""));
  const adminApiToken = String(config?.admin_api_token ?? "").trim();
  if (!adminApiToken) {
    throw new Error("Admin API Access Token is required");
  }

  const response = await fetch(`${normalizedStoreUrl}/admin/api/2024-10/shop.json`, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": adminApiToken,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid Shopify token or insufficient permissions");
    }
    throw new Error(`Shopify connection failed (${response.status})`);
  }

  const data = await response.json();
  const shop = data?.shop;
  if (!shop) throw new Error("Invalid Shopify response");
  const grantedScopes = await fetchShopifyGrantedScopes(normalizedStoreUrl, adminApiToken);

  return {
    provider: "shopify",
    accountLabel: shop.name || storeDomain,
    baseUrl: normalizedStoreUrl,
    metadata: {
      storeDomain,
      customDomain:
        typeof shop.domain === "string" && shop.domain.trim()
          ? shop.domain.trim()
          : null,
      storeName: shop.name ?? null,
      grantedScopes,
    },
  };
}

/**
 * The access scopes the token was granted, or null when Shopify would not say.
 * Settings compares them with what each tool needs.
 */
export async function fetchShopifyGrantedScopes(storeUrl: string, adminApiToken: string): Promise<string[] | null> {
  try {
    const response = await fetch(`${storeUrl}/admin/oauth/access_scopes.json`, {
      headers: { "X-Shopify-Access-Token": adminApiToken, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { access_scopes?: Array<{ handle?: unknown }> };
    if (!Array.isArray(data?.access_scopes)) return null;
    return data.access_scopes.flatMap((s) => (typeof s?.handle === "string" ? [s.handle] : [])).sort();
  } catch {
    return null;
  }
}
