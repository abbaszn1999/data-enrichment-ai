import type { ApplyChangesInput, ApplyChangesResult, IntegrationRecord, SyncSheetRow } from "../../core/types";
import { runWithConcurrency } from "../../core/batch-executor";
import {
  buildShopifyProductPayload,
  buildShopifyVariantPayload,
  buildShopifyImagePayload,
} from "./payload-builders";

type ShopifyLocation = { id: number; name?: string };
type ShopifyProductImage = { id?: number; src?: string; alt?: string };
type ShopifyProductResponse = {
  product?: { id?: number; image?: ShopifyProductImage | null; images?: ShopifyProductImage[] };
};

function toNormalizedText(value: unknown) {
  return String(value ?? "").trim();
}

function toOptionalNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function getAdminToken(integration: IntegrationRecord) {
  const token = String((integration.config as any)?.admin_api_token ?? "").trim();
  if (!token) throw new Error("Missing Shopify admin token in integration config");
  return token;
}

async function getPrimaryShopifyLocation(integration: IntegrationRecord, token: string): Promise<ShopifyLocation> {
  const response = await fetch(`${integration.base_url}/admin/api/2024-10/locations.json`, {
    method: "GET",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 403) {
      throw new Error("Inventory sync requires Shopify approval for the read_locations scope. Reconnect with inventory location permissions.");
    }
    throw new Error(`Failed to load Shopify locations (${response.status})${text ? `: ${text}` : ""}`);
  }
  const data = (await response.json().catch(() => ({}))) as { locations?: ShopifyLocation[] };
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const primary = locations.find((l) => Number.isFinite(l?.id)) ?? null;
  if (!primary?.id) throw new Error("No Shopify location found for inventory sync");
  return primary;
}

async function setShopifyInventoryLevel(params: {
  integration: IntegrationRecord;
  token: string;
  inventoryItemId: string;
  available: number;
  locationId: number;
}) {
  const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/inventory_levels/set.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": params.token, "Content-Type": "application/json" },
    body: JSON.stringify({
      location_id: params.locationId,
      inventory_item_id: Number(params.inventoryItemId),
      available: params.available,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to update Shopify inventory (${response.status})${text ? `: ${text}` : ""}`);
  }
}

async function updateShopifyVariant(params: {
  integration: IntegrationRecord;
  token: string;
  row: SyncSheetRow;
  changedColumns: string[];
}) {
  const variantId = toNormalizedText(params.row.variant_id);
  if (!variantId) throw new Error("Missing variant_id for Shopify variant update");
  const variant = buildShopifyVariantPayload(params.row, params.changedColumns);
  if (Object.keys(variant).length === 0) return;

  const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/variants/${variantId}.json`, {
    method: "PUT",
    headers: { "X-Shopify-Access-Token": params.token, "Content-Type": "application/json" },
    body: JSON.stringify({ variant: { id: Number(variantId), ...variant } }),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to update Shopify variant ${variantId} (${response.status})${text ? `: ${text}` : ""}`);
  }
}

async function setShopifySeoMetafields(params: {
  integration: IntegrationRecord;
  token: string;
  productId: string;
  row: SyncSheetRow;
  changedColumns: string[];
}) {
  const metafields: Array<Record<string, string>> = [];
  if (params.changedColumns.includes("seo_title")) {
    metafields.push({
      namespace: "global",
      key: "title_tag",
      ownerId: `gid://shopify/Product/${params.productId}`,
      type: "single_line_text_field",
      value: toNormalizedText(params.row.seo_title),
    });
  }
  if (params.changedColumns.includes("seo_description")) {
    metafields.push({
      namespace: "global",
      key: "description_tag",
      ownerId: `gid://shopify/Product/${params.productId}`,
      type: "single_line_text_field",
      value: toNormalizedText(params.row.seo_description),
    });
  }
  if (metafields.length === 0) return;

  const response = await fetch(`${params.integration.base_url}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": params.token, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { key namespace value }
          userErrors { field message code }
        }
      }`,
      variables: { metafields },
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as {
    data?: { metafieldsSet?: { userErrors?: Array<{ message?: string }> } };
  };
  if (!response.ok) throw new Error(`Failed to update Shopify SEO metafields for product ${params.productId}`);
  const userErrors = data?.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).filter(Boolean).join("; ") || `Failed to update SEO metafields for product ${params.productId}`);
  }
}

function resolveFeaturedImageId(row: SyncSheetRow, productResponse?: ShopifyProductResponse | null) {
  const directId = toNormalizedText(row.featured_image_id);
  if (directId) return directId;
  const responseImageId = productResponse?.product?.image?.id;
  if (responseImageId) return String(responseImageId);
  const firstImageId = productResponse?.product?.images?.find((i) => Number.isFinite(i?.id))?.id;
  return firstImageId ? String(firstImageId) : "";
}

async function updateShopifyProductImageAlt(params: {
  integration: IntegrationRecord;
  token: string;
  productId: string;
  imageId: string;
  altText: string;
}) {
  const response = await fetch(
    `${params.integration.base_url}/admin/api/2024-10/products/${params.productId}/images/${params.imageId}.json`,
    {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": params.token, "Content-Type": "application/json" },
      body: JSON.stringify({ image: { id: Number(params.imageId), alt: params.altText } }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to update Shopify image alt text for product ${params.productId} (${response.status})${text ? `: ${text}` : ""}`);
  }
}

async function updateShopifyProduct(params: {
  integration: IntegrationRecord;
  token: string;
  productId: string;
  row: SyncSheetRow;
  changedColumns: string[];
  locationId?: number | null;
}): Promise<{ skipped: boolean }> {
  const product = buildShopifyProductPayload(params.row, params.changedColumns);
  const images = buildShopifyImagePayload(params.row, params.changedColumns);
  const shouldUpdateInventory = params.changedColumns.includes("inventory_total");
  const shouldUpdateVariant = ["price", "compare_at_price", "primary_sku", "barcode", "inventory_policy"].some((c) => params.changedColumns.includes(c));
  const shouldUpdateSeo = params.changedColumns.includes("seo_title") || params.changedColumns.includes("seo_description");
  const shouldUpdateImageAlt = params.changedColumns.includes("featured_image_alt_text");

  if (Object.keys(product).length === 0 && !images && !shouldUpdateInventory && !shouldUpdateVariant && !shouldUpdateSeo && !shouldUpdateImageAlt) {
    return { skipped: true };
  }

  if (images) product.images = images;

  let productResponse: ShopifyProductResponse | null = null;
  if (Object.keys(product).length > 0 || images) {
    const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/products/${params.productId}.json`, {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": params.token, "Content-Type": "application/json" },
      body: JSON.stringify({ product: { id: Number(params.productId), ...product } }),
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to update Shopify product ${params.productId} (${response.status})${text ? `: ${text}` : ""}`);
    }
    productResponse = (await response.json().catch(() => ({}))) as ShopifyProductResponse;
  }

  if (shouldUpdateVariant) {
    await updateShopifyVariant({ integration: params.integration, token: params.token, row: params.row, changedColumns: params.changedColumns });
  }
  if (shouldUpdateInventory) {
    const inventoryItemId = toNormalizedText(params.row.inventory_item_id);
    const inventoryQuantity = toOptionalNumber(params.row.inventory_total);
    if (!inventoryItemId) throw new Error(`Missing inventory_item_id for product ${params.productId}. Reload products and try again.`);
    if (inventoryQuantity === null) throw new Error(`Invalid inventory_total for product ${params.productId}`);
    if (!params.locationId) throw new Error(`Missing Shopify location for inventory update on product ${params.productId}`);
    await setShopifyInventoryLevel({
      integration: params.integration,
      token: params.token,
      inventoryItemId,
      available: inventoryQuantity,
      locationId: params.locationId,
    });
  }
  if (shouldUpdateSeo) {
    await setShopifySeoMetafields({
      integration: params.integration,
      token: params.token,
      productId: params.productId,
      row: params.row,
      changedColumns: params.changedColumns,
    });
  }
  if (shouldUpdateImageAlt) {
    const imageId = resolveFeaturedImageId(params.row, productResponse);
    if (!imageId) throw new Error(`Missing featured_image_id for product ${params.productId}. Reload products and try again.`);
    await updateShopifyProductImageAlt({
      integration: params.integration,
      token: params.token,
      productId: params.productId,
      imageId,
      altText: toNormalizedText(params.row.featured_image_alt_text),
    });
  }
  return { skipped: false };
}

async function createShopifyProduct(params: { integration: IntegrationRecord; token: string; row: SyncSheetRow }) {
  const product = buildShopifyProductPayload(params.row);
  const variant = buildShopifyVariantPayload(params.row);
  const images = buildShopifyImagePayload(params.row);
  if (!String(product.title ?? "").trim()) throw new Error("Cannot create a Shopify product without a title");
  if (Object.keys(variant).length > 0) (product as any).variants = [variant];
  if (images) (product as any).images = images;

  const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/products.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": params.token, "Content-Type": "application/json" },
    body: JSON.stringify({ product }),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to create Shopify product (${response.status})${text ? `: ${text}` : ""}`);
  }
}

export async function applyShopifyChanges(input: ApplyChangesInput): Promise<ApplyChangesResult> {
  const { integration, creates, updates } = input;
  const token = getAdminToken(integration);
  const needsLocation = updates.some((u) => Array.isArray(u?.changedColumns) && u.changedColumns.includes("inventory_total"));
  const location = needsLocation ? await getPrimaryShopifyLocation(integration, token) : null;

  const validUpdates = updates.filter((u) => u?.productId?.trim());
  let skippedCount = updates.length - validUpdates.length;

  const updateResult = await runWithConcurrency(
    validUpdates,
    (u) => updateShopifyProduct({
      integration,
      token,
      productId: u.productId,
      row: u.row ?? {},
      changedColumns: Array.isArray(u.changedColumns) ? u.changedColumns : [],
      locationId: location?.id ?? null,
    }),
    { concurrency: 2, delayMsBetweenBatches: 550 }
  );

  let updatedCount = 0;
  for (const r of updateResult.successes) {
    if (r.skipped) skippedCount += 1;
    else updatedCount += 1;
  }

  const createResult = await runWithConcurrency(
    creates,
    (row) => createShopifyProduct({ integration, token, row: row ?? {} }),
    { concurrency: 2, delayMsBetweenBatches: 550 }
  );

  return {
    createdCount: createResult.successes.length,
    updatedCount,
    skippedCount,
    errors: [
      ...updateResult.errors.map((e) => e.error),
      ...createResult.errors.map((e) => e.error),
    ],
  };
}
