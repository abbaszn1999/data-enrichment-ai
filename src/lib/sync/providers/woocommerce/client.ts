import { HttpClient } from "../../core/http-client";
import type { IntegrationRecord } from "../../core/types";
import { buildWooCommerceAuthHeader } from "./auth";

export function createWooClient(integration: IntegrationRecord): HttpClient {
  if (integration.provider !== "woocommerce") {
    throw new Error(`Expected woocommerce provider, got ${integration.provider}`);
  }
  if (!integration.base_url) {
    throw new Error("Missing WooCommerce base URL");
  }
  const config = (integration.config ?? {}) as { username?: string; application_password?: string };
  const authHeader = buildWooCommerceAuthHeader(config.username ?? "", config.application_password ?? "");

  return new HttpClient({
    baseUrl: `${integration.base_url}/wp-json/wc/v3`,
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
    provider: "woocommerce",
    maxRetries: 3,
    retryDelayMs: 800,
  });
}
