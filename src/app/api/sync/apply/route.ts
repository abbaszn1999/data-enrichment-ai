import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 300;

type SyncSheetRow = Record<string, unknown>;

type ApplyUpdate = {
  productId: string;
  row: SyncSheetRow;
  changedColumns: string[];
};

type ApplyRequest = {
  workspaceId?: string;
  creates?: SyncSheetRow[];
  updates?: ApplyUpdate[];
};

type ShopifyIntegration = {
  provider: string;
  integration_name: string;
  base_url?: string;
  config?: Record<string, unknown> | null;
};

type ShopifyLocation = {
  id: number;
  name?: string;
};

type ShopifyProductImage = {
  id?: number;
  src?: string;
  alt?: string;
};

type ShopifyProductResponse = {
  product?: {
    id?: number;
    image?: ShopifyProductImage | null;
    images?: ShopifyProductImage[];
  };
};

const SYNCABLE_COLUMN_MAP: Record<string, string> = {
  title: "title",
  handle: "handle",
  status: "status",
  vendor: "vendor",
  product_type: "product_type",
  tags: "tags",
  description: "body_html",
  body_html: "body_html",
};

async function requireWorkspaceMember(workspaceId: string, userId: string) {
  const admin = createAdminClient();
  const { data: member, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .single();

  if (error || !member) {
    throw new Error("Forbidden");
  }

  return admin;
}

async function getShopifyIntegration(workspaceId: string, userId: string): Promise<ShopifyIntegration> {
  const admin = await requireWorkspaceMember(workspaceId, userId);
  const { data: integration, error } = await admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!integration) {
    throw new Error("No connected integration found");
  }

  if (integration.provider !== "shopify") {
    throw new Error(`${integration.provider} is not supported yet for Sync apply`);
  }

  return integration as ShopifyIntegration;
}

function toNormalizedText(value: unknown) {
  return String(value ?? "").trim();
}

function toOptionalNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function buildShopifyProductPayload(row: SyncSheetRow, allowedColumns?: string[]) {
  const payload: Record<string, unknown> = {};
  const columnsToUse = allowedColumns && allowedColumns.length > 0
    ? allowedColumns.filter((column) => column in SYNCABLE_COLUMN_MAP)
    : Object.keys(SYNCABLE_COLUMN_MAP);

  for (const column of columnsToUse) {
    const targetField = SYNCABLE_COLUMN_MAP[column];
    if (!targetField) continue;

    const value = row[column];
    if (value === undefined) continue;

    if (column === "handle") {
      const normalizedHandle = String(value ?? "").trim();
      if (normalizedHandle) {
        payload[targetField] = normalizedHandle;
      }
      continue;
    }

    payload[targetField] = String(value ?? "").trim();
  }

  return payload;
}

function buildShopifyVariantPayload(row: SyncSheetRow, allowedColumns?: string[]) {
  const columns = new Set(allowedColumns ?? []);
  const shouldIncludeAll = !allowedColumns || allowedColumns.length === 0;

  const variant: Record<string, unknown> = {};

  if (shouldIncludeAll || columns.has("price")) {
    const price = toNormalizedText(row.price);
    if (price) {
      variant.price = price;
    }
  }

  if (shouldIncludeAll || columns.has("compare_at_price")) {
    const compareAtPrice = toNormalizedText(row.compare_at_price);
    if (compareAtPrice) {
      variant.compare_at_price = compareAtPrice;
    }
  }

  if (shouldIncludeAll || columns.has("primary_sku")) {
    const sku = toNormalizedText(row.primary_sku);
    if (sku) {
      variant.sku = sku;
    }
  }

  if (shouldIncludeAll || columns.has("barcode")) {
    variant.barcode = toNormalizedText(row.barcode);
  }

  if (shouldIncludeAll || columns.has("inventory_policy")) {
    const inventoryPolicy = toNormalizedText(row.inventory_policy);
    if (inventoryPolicy === "continue" || inventoryPolicy === "deny") {
      variant.inventory_policy = inventoryPolicy;
    }
  }

  return variant;
}

function buildShopifyImagePayload(row: SyncSheetRow, allowedColumns?: string[]) {
  const shouldIncludeAll = !allowedColumns || allowedColumns.length === 0;
  const shouldIncludeFeaturedImage = shouldIncludeAll || allowedColumns.includes("featured_image");

  if (!shouldIncludeFeaturedImage) {
    return null;
  }

  const featuredImage = toNormalizedText(row.featured_image);
  if (!featuredImage) {
    return null;
  }

  return [{ src: featuredImage }];
}

async function getPrimaryShopifyLocation(params: {
  integration: ShopifyIntegration;
  adminApiToken: string;
}) {
  const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/locations.json`, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": params.adminApiToken,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 403) {
      throw new Error("Inventory sync requires Shopify approval for the read_locations scope. Reconnect the Shopify integration with inventory location permissions, or sync without changing inventory_total.");
    }
    throw new Error(`Failed to load Shopify locations (${response.status})${text ? `: ${text}` : ""}`);
  }

  const data = (await response.json().catch(() => ({}))) as { locations?: ShopifyLocation[] };
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const primaryLocation = locations.find((location) => Number.isFinite(location?.id)) ?? null;

  if (!primaryLocation?.id) {
    throw new Error("No Shopify location found for inventory sync");
  }

  return primaryLocation;
}

async function setShopifyInventoryLevel(params: {
  integration: ShopifyIntegration;
  adminApiToken: string;
  inventoryItemId: string;
  available: number;
  locationId: number;
}) {
  const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/inventory_levels/set.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": params.adminApiToken,
      "Content-Type": "application/json",
    },
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
  integration: ShopifyIntegration;
  adminApiToken: string;
  row: SyncSheetRow;
  changedColumns: string[];
}) {
  const variantId = toNormalizedText(params.row.variant_id);
  if (!variantId) {
    throw new Error("Missing variant_id for Shopify variant update");
  }

  const variant = buildShopifyVariantPayload(params.row, params.changedColumns);
  if (Object.keys(variant).length === 0) {
    return;
  }

  const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/variants/${variantId}.json`, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": params.adminApiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      variant: {
        id: Number(variantId),
        ...variant,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to update Shopify variant ${variantId} (${response.status})${text ? `: ${text}` : ""}`);
  }
}

async function setShopifySeoMetafields(params: {
  integration: ShopifyIntegration;
  adminApiToken: string;
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

  if (metafields.length === 0) {
    return;
  }

  const response = await fetch(`${params.integration.base_url}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": params.adminApiToken,
      "Content-Type": "application/json",
    },
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

  const data = await response.json().catch(() => ({})) as {
    data?: {
      metafieldsSet?: {
        userErrors?: Array<{ message?: string }>;
      };
    };
  };

  if (!response.ok) {
    throw new Error(`Failed to update Shopify SEO metafields for product ${params.productId}`);
  }

  const userErrors = data?.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((item) => item.message).filter(Boolean).join("; ") || `Failed to update SEO metafields for product ${params.productId}`);
  }
}

function resolveFeaturedImageId(row: SyncSheetRow, productResponse?: ShopifyProductResponse | null) {
  const directId = toNormalizedText(row.featured_image_id);
  if (directId) {
    return directId;
  }

  const responseImageId = productResponse?.product?.image?.id;
  if (responseImageId) {
    return String(responseImageId);
  }

  const firstImageId = productResponse?.product?.images?.find((image) => Number.isFinite(image?.id))?.id;
  return firstImageId ? String(firstImageId) : "";
}

async function updateShopifyProductImageAlt(params: {
  integration: ShopifyIntegration;
  adminApiToken: string;
  productId: string;
  imageId: string;
  altText: string;
}) {
  const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/products/${params.productId}/images/${params.imageId}.json`, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": params.adminApiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image: {
        id: Number(params.imageId),
        alt: params.altText,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to update Shopify image alt text for product ${params.productId} (${response.status})${text ? `: ${text}` : ""}`);
  }
}

async function updateShopifyProduct(params: {
  integration: ShopifyIntegration;
  productId: string;
  row: SyncSheetRow;
  changedColumns: string[];
  locationId?: number | null;
}) {
  const adminApiToken = String(params.integration.config?.admin_api_token ?? "").trim();
  if (!adminApiToken) {
    throw new Error("Missing Shopify admin token in integration config");
  }

  const product = buildShopifyProductPayload(params.row, params.changedColumns);
  const images = buildShopifyImagePayload(params.row, params.changedColumns);
  const shouldUpdateInventory = params.changedColumns.includes("inventory_total");
  const shouldUpdateVariant = ["price", "compare_at_price", "primary_sku", "barcode", "inventory_policy"].some((column) => params.changedColumns.includes(column));
  const shouldUpdateSeo = params.changedColumns.includes("seo_title") || params.changedColumns.includes("seo_description");
  const shouldUpdateImageAlt = params.changedColumns.includes("featured_image_alt_text");
  if (Object.keys(product).length === 0 && !images && !shouldUpdateInventory && !shouldUpdateVariant && !shouldUpdateSeo && !shouldUpdateImageAlt) {
    return { skipped: true };
  }

  if (images) {
    product.images = images;
  }

  let productResponse: ShopifyProductResponse | null = null;

  if (Object.keys(product).length > 0 || images) {
    const response = await fetch(
      `${params.integration.base_url}/admin/api/2024-10/products/${params.productId}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": adminApiToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product: {
            id: Number(params.productId),
            ...product,
          },
        }),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to update Shopify product ${params.productId} (${response.status})${text ? `: ${text}` : ""}`);
    }

    productResponse = (await response.json().catch(() => ({}))) as ShopifyProductResponse;
  }

  if (shouldUpdateVariant) {
    await updateShopifyVariant({
      integration: params.integration,
      adminApiToken,
      row: params.row,
      changedColumns: params.changedColumns,
    });
  }

  if (shouldUpdateInventory) {
    const inventoryItemId = toNormalizedText(params.row.inventory_item_id);
    const inventoryQuantity = toOptionalNumber(params.row.inventory_total);

    if (!inventoryItemId) {
      throw new Error(`Missing inventory_item_id for product ${params.productId}. Reload products from Shopify and try again.`);
    }

    if (inventoryQuantity === null) {
      throw new Error(`Invalid inventory_total for product ${params.productId}`);
    }

    if (!params.locationId) {
      throw new Error(`Missing Shopify location for inventory update on product ${params.productId}`);
    }

    await setShopifyInventoryLevel({
      integration: params.integration,
      adminApiToken,
      inventoryItemId,
      available: inventoryQuantity,
      locationId: params.locationId,
    });
  }

  if (shouldUpdateSeo) {
    await setShopifySeoMetafields({
      integration: params.integration,
      adminApiToken,
      productId: params.productId,
      row: params.row,
      changedColumns: params.changedColumns,
    });
  }

  if (shouldUpdateImageAlt) {
    const imageId = resolveFeaturedImageId(params.row, productResponse);
    if (!imageId) {
      throw new Error(`Missing featured_image_id for product ${params.productId}. Reload products from Shopify and try again.`);
    }

    await updateShopifyProductImageAlt({
      integration: params.integration,
      adminApiToken,
      productId: params.productId,
      imageId,
      altText: toNormalizedText(params.row.featured_image_alt_text),
    });
  }

  return { skipped: false };
}

async function createShopifyProduct(params: {
  integration: ShopifyIntegration;
  row: SyncSheetRow;
}) {
  const adminApiToken = String(params.integration.config?.admin_api_token ?? "").trim();
  if (!adminApiToken) {
    throw new Error("Missing Shopify admin token in integration config");
  }

  const product = buildShopifyProductPayload(params.row);
  const variant = buildShopifyVariantPayload(params.row);
  const images = buildShopifyImagePayload(params.row);
  if (!String(product.title ?? "").trim()) {
    throw new Error("Cannot create a Shopify product without a title");
  }

  if (Object.keys(variant).length > 0) {
    product.variants = [variant];
  }

  if (images) {
    product.images = images;
  }

  const response = await fetch(`${params.integration.base_url}/admin/api/2024-10/products.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": adminApiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ product }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to create Shopify product (${response.status})${text ? `: ${text}` : ""}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { workspaceId, creates = [], updates = [] } = (await request.json()) as ApplyRequest;

    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const integration = await getShopifyIntegration(workspaceId, user.id);
    const adminApiToken = String(integration.config?.admin_api_token ?? "").trim();
    const needsInventoryLocation = updates.some(
      (update) => Array.isArray(update?.changedColumns) && update.changedColumns.includes("inventory_total")
    );
    const location = needsInventoryLocation && adminApiToken
      ? await getPrimaryShopifyLocation({ integration, adminApiToken })
      : null;

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    const CONCURRENCY = 2;
    const BATCH_DELAY_MS = 550;

    // Parallel update helper
    const validUpdates = updates.filter((u) => u?.productId?.trim());
    skippedCount += updates.length - validUpdates.length;

    for (let i = 0; i < validUpdates.length; i += CONCURRENCY) {
      const batch = validUpdates.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((update) =>
          updateShopifyProduct({
            integration,
            productId: update.productId,
            row: update.row ?? {},
            changedColumns: Array.isArray(update.changedColumns) ? update.changedColumns : [],
            locationId: location?.id ?? null,
          })
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value.skipped) {
            skippedCount += 1;
          } else {
            updatedCount += 1;
          }
        } else {
          errors.push(result.reason?.message || "Unknown update error");
        }
      }

      if (i + CONCURRENCY < validUpdates.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    // Parallel create helper
    for (let i = 0; i < creates.length; i += CONCURRENCY) {
      const batch = creates.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((row) =>
          createShopifyProduct({
            integration,
            row: row ?? {},
          })
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          createdCount += 1;
        } else {
          errors.push(result.reason?.message || "Unknown create error");
        }
      }

      if (i + CONCURRENCY < creates.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const errorSuffix = errors.length > 0 ? ` (${errors.length} failed)` : "";
    return NextResponse.json({
      message: `Sync completed: ${updatedCount} updated, ${createdCount} created${skippedCount > 0 ? `, ${skippedCount} skipped` : ""}${errorSuffix}.`,
      updatedCount,
      createdCount,
      skippedCount,
      errorCount: errors.length,
      errors: errors.slice(0, 5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: message === "Forbidden" ? 403 : 500 });
  }
}
