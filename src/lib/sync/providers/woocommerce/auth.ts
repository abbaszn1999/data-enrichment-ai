import type { ProviderTestResult } from "../../core/types";

export function normalizeWooCommerceStoreUrl(input: string) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) throw new Error("Store URL is required");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Invalid store URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Store URL must use http or https");
  }
  // Strip trailing slash from pathname
  const pathname = url.pathname.replace(/\/+$/, "");
  const baseUrl = `${url.protocol}//${url.host}${pathname}`;
  return { storeUrl: baseUrl, storeDomain: url.host.toLowerCase() };
}

/**
 * Build Basic Auth header using WordPress Application Passwords.
 * WordPress Application Passwords use the format: username:application_password
 * Generated from WordPress admin → Users → Profile → Application Passwords.
 */
export function buildWooCommerceAuthHeader(username: string, applicationPassword: string) {
  const user = (username ?? "").trim();
  const pass = (applicationPassword ?? "").trim();
  if (!user || !pass) throw new Error("WordPress username and application password are required");
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return `Basic ${token}`;
}

export async function testWooCommerceConnection(config: Record<string, any>): Promise<ProviderTestResult> {
  const { storeUrl: normalizedStoreUrl, storeDomain } = normalizeWooCommerceStoreUrl(String(config?.store_url ?? ""));
  const username = String(config?.username ?? "").trim();
  const applicationPassword = String(config?.application_password ?? "").trim();
  if (!username || !applicationPassword) {
    throw new Error("WordPress username and application password are required");
  }

  const authHeader = buildWooCommerceAuthHeader(username, applicationPassword);

  // Lightweight probe: list 1 product. system_status requires read_write+admin.
  const url = `${normalizedStoreUrl}/wp-json/wc/v3/products?per_page=1`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader, "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach WooCommerce store: ${msg}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Invalid WordPress credentials — check your username and application password.");
  }
  if (response.status === 404) {
    throw new Error("WooCommerce REST API not found at /wp-json/wc/v3 — verify WooCommerce is installed and permalinks are not Plain.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`WooCommerce connection failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  // Try to detect store name + currency via /settings/general (best-effort)
  let storeName: string | null = null;
  let currency: string | null = null;
  let wcVersion: string | null = null;
  try {
    const settingsResponse = await fetch(`${normalizedStoreUrl}/wp-json/wc/v3/settings/general`, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
      cache: "no-store",
    });
    if (settingsResponse.ok) {
      const settings = (await settingsResponse.json().catch(() => [])) as Array<{ id?: string; value?: string }>;
      const findValue = (id: string) => settings.find((s) => s?.id === id)?.value ?? null;
      storeName = findValue("woocommerce_store_address") ? null : null;
      // The actual blog/site name is in WP options, not WC settings. Try /wp-json/ root.
      currency = findValue("woocommerce_currency") || null;
    }
  } catch {
    // ignore — non-fatal
  }
  try {
    const rootResponse = await fetch(`${normalizedStoreUrl}/wp-json/`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (rootResponse.ok) {
      const root = (await rootResponse.json().catch(() => ({}))) as { name?: string; description?: string };
      if (root.name) storeName = root.name;
    }
  } catch {
    // ignore
  }
  try {
    const sysResponse = await fetch(`${normalizedStoreUrl}/wp-json/wc/v3/system_status`, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
      cache: "no-store",
    });
    if (sysResponse.ok) {
      const sys = (await sysResponse.json().catch(() => ({}))) as any;
      wcVersion = sys?.environment?.version ?? null;
    }
  } catch {
    // ignore
  }

  return {
    provider: "woocommerce",
    accountLabel: storeName || storeDomain,
    baseUrl: normalizedStoreUrl,
    metadata: {
      storeDomain,
      storeName,
      currency,
      wcVersion,
    },
  };
}
