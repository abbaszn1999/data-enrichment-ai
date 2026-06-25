export const WOOCOMMERCE_API_VERSION = "wc/v3" as const;

export const WOOCOMMERCE_LIMITS = {
  batchLimit: 100,
  perPageMax: 100,
} as const;

/**
 * Server-side filter keys honored when loading WooCommerce products.
 * Currently empty: the fetch path loads pages then filters client-side. As
 * native `/products` query params (search, category, sku, status, …) get wired
 * in, list them here so the agent knows it can push them to the API.
 */
export const WOOCOMMERCE_SERVER_FILTER_KEYS = [] as const;

/**
 * Client-side predicates applied after fetch. These operate on the canonical
 * column vocabulary, so the same kinds Shopify uses apply to WooCommerce rows.
 */
export const WOOCOMMERCE_CLIENT_PREDICATE_KINDS = [
  "missing_image",
  "image_count_lt",
  "description_shorter_than",
  "missing_seo_title",
  "missing_seo_description",
  "missing_alt_text",
  "title_matches",
  "no_collections",
  "body_html_empty",
] as const;

export const WOOCOMMERCE_WRITABLE_COLUMNS = [
  "title",
  "handle",
  "status",
  "type",
  "tags",
  "categories",
  "categories_ids",
  "price",
  "compare_at_price",
  "inventory_total",
  "primary_sku",
  "barcode",
  "global_unique_id",
  "manage_stock",
  "stock_status",
  "featured_image",
  "featured_image_alt_text",
  "short_description",
  "body_html",
  "weight",
  "seo_title",
  "seo_description",
] as const;

export type WooCommerceWritableColumn = (typeof WOOCOMMERCE_WRITABLE_COLUMNS)[number];

export const WOOCOMMERCE_COLUMN_PROFILES: Record<string, string[]> = {
  core: [
    "title",
    "status",
    "type",
    "price",
    "inventory_total",
  ],
  pricing: [
    "title",
    "price",
    "compare_at_price",
    "inventory_total",
    "stock_status",
  ],
  seo: ["title", "handle", "seo_title", "seo_description"],
  content: [
    "title",
    "short_description",
    "body_html",
    "seo_title",
    "seo_description",
    "tags",
  ],
  imagery: [
    "title",
    "featured_image",
    "featured_image_alt_text",
  ],
  inventory: [
    "title",
    "primary_sku",
    "barcode",
    "global_unique_id",
    "manage_stock",
    "stock_status",
    "inventory_total",
    "variant_count",
  ],
  taxonomy: [
    "title",
    "type",
    "categories",
    "categories_ids",
    "tags",
  ],
  variants: [
    "title",
    "variation_id",
    "variant_count",
    "primary_sku",
    "price",
    "compare_at_price",
    "inventory_total",
    "featured_image",
  ],
  all: [],
};
