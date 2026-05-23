export const WOOCOMMERCE_API_VERSION = "wc/v3" as const;

export const WOOCOMMERCE_LIMITS = {
  batchLimit: 100,
  perPageMax: 100,
} as const;

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
