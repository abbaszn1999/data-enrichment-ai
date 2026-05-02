import type { FetchProductsOptions, IntegrationRecord, SyncSheet } from "../../core/types";
import { buildShopifyCoreProductsSheet } from "./normalize";

export async function fetchShopifyProductsSheet(
  integration: IntegrationRecord,
  options: FetchProductsOptions = {}
): Promise<SyncSheet> {
  if (integration.provider !== "shopify") {
    throw new Error(`Expected shopify provider, got ${integration.provider}`);
  }
  const adminApiToken = String((integration.config as any)?.admin_api_token ?? "").trim();
  if (!adminApiToken) {
    throw new Error("Missing Shopify admin token in integration config");
  }
  if (!integration.base_url) {
    throw new Error("Missing Shopify base URL");
  }

  const limit = options.limit ?? 50;
  const shouldLoadAll = limit <= 0;
  const allProducts: any[] = [];

  let nextUrl: URL | null = new URL(`${integration.base_url}/admin/api/2024-10/products.json`);
  nextUrl.searchParams.set("limit", shouldLoadAll ? "250" : String(Math.min(Math.max(limit, 1), 250)));
  nextUrl.searchParams.set(
    "fields",
    "id,title,handle,status,vendor,product_type,tags,body_html,seo_title,seo_description,published_at,created_at,updated_at,variants,image,images"
  );

  while (nextUrl) {
    const response: Response = await fetch(nextUrl.toString(), {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": adminApiToken,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Shopify products request failed (${response.status})${text ? `: ${text}` : ""}`);
    }

    const data = await response.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    allProducts.push(...products);

    if (!shouldLoadAll || products.length < 250) break;

    const linkHeader = response.headers.get("link") || response.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
    if (!nextMatch?.[1]) break;
    nextUrl = new URL(nextMatch[1]);
  }

  return buildShopifyCoreProductsSheet({
    integrationName: integration.integration_name,
    products: allProducts,
  });
}
