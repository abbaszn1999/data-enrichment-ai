// Typed catalog of what Shopify GraphQL Admin API 2026-04 supports.
// The agent can ONLY use filters listed here. No introspection at runtime.

/** Keys Shopify `products(query:)` accepts. Verified against shopify.dev 2026-04. */
export const SERVER_FILTER_KEYS = [
  "title",
  "barcode",
  "bundles",
  "category_id",
  "collection_id",
  "created_at",
  "delivery_profile_id",
  "gift_card",
  "handle",
  "has_only_composites",
  "has_only_default_variant",
  "has_variant_with_components",
  "id",
  "inventory_total",
  "is_price_reduced",
  "metafields",
  "out_of_stock_somewhere",
  "price",
  "product_configuration_owner",
  "product_publication_status",
  "product_type",
  "published_status",
  "sku",
  "status",
  "tag",
  "updated_at",
  "variants.price",
  "vendor",
] as const;

export type ServerFilterKey = (typeof SERVER_FILTER_KEYS)[number];

/** Keys the agent may apply locally after fetch (Shopify cannot filter them). */
export const CLIENT_PREDICATE_KINDS = [
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

export type ClientPredicateKind = (typeof CLIENT_PREDICATE_KINDS)[number];

/** Approximate GraphQL field costs used by the planner for pre-flight estimate. */
export const FIELD_COSTS = {
  productsConnection: 5, // base for `products(first:N)`
  perProductBase: 1,
  variantsFirst10: 2,
  variantsFirst100: 10,
  imagesFirst10: 2,
  metafieldsFirst25: 2.5,
  collectionsFirst25: 2.5,
  seoField: 0.5,
  productSetMutation: 10,
  productSetMetafield: 0.4,
  productSetFile: 1.9,
} as const;

/** Shopify hard limits (verified). */
export const SHOPIFY_LIMITS = {
  singleQueryMaxCost: 1000,
  inputArrayMax: 250,
  bulkConcurrentMax: 5,
  bulkJsonlMaxBytes: 100 * 1024 * 1024,
  bulkTimeoutMs: 24 * 60 * 60 * 1000,
} as const;

/**
 * Columns the AI is allowed to write into via `sync_columns_write_with_ai`.
 * Used as a strict enum in the tool's Zod schema so the model never invents
 * a target column name. Add new entries here when you want the agent to be
 * able to fill them.
 */
export const WRITABLE_COLUMNS = [
  "title",
  "body_html",
  "description",
  "seo_title",
  "seo_description",
  "handle",
  "tags",
  "vendor",
  "product_type",
  "status",
  "price",
  "compare_at_price",
  "primary_sku",
  "barcode",
  "featured_image_alt_text",
  "image_alt_text",
] as const;

export type WritableColumn = (typeof WRITABLE_COLUMNS)[number];

/** Column profiles — replaces static SHEET_VIEWS. */
export const COLUMN_PROFILES: Record<string, string[]> = {
  core: [
    "title",
    "status",
    "vendor",
    "product_type",
    "price",
    "inventory_total",
  ],
  pricing: [
    "title",
    "price",
    "compare_at_price",
    "inventory_total",
    "status",
  ],
  seo: ["title", "handle", "seo_title", "seo_description"],
  content: [
    "title",
    "body_html",
    "seo_title",
    "seo_description",
    "tags",
  ],
  imagery: [
    "title",
    "featured_image",
    "featured_image_alt_text",
    "image_count",
  ],
  inventory: [
    "title",
    "primary_sku",
    "barcode",
    "inventory_total",
    "variant_count",
    "status",
  ],
  // Collections entity — shown only when the sheet holds Shopify collections,
  // NOT when viewing products. The UI uses `currentEntity === "collections"`
  // to select this profile. Column names MUST match `collectionNodeToRow` in
  // providers/shopify/collections.ts (snake_case) — earlier builds used camel-
  // case here which silently hid every column except title/handle.
  collections: [
    "title",
    "handle",
    "description",
    "image",
    "image_alt_text",
    "published",
    "products_count",
    "seo_title",
    "seo_description",
    "sort_order",
    "type",
    "updated_at",
  ],
  publishing: [
    "title",
    "handle",
    "status",
    "published_at",
    "updated_at",
    "created_at",
  ],
  taxonomy: ["title", "product_type", "tags", "vendor", "collections"],
  translations: ["title", "handle", "body_html"],
  variants: [
    "title",
    "variant_count",
    "primary_sku",
    "price",
    "inventory_total",
  ],
  metafields: ["title"],
  all: [], // empty = render all columns present in rows
};

/** Collection rule columns (Shopify smart-collection rule `column` enum). */
export const COLLECTION_RULE_COLUMNS = [
  "TAG",
  "TITLE",
  "TYPE",
  "VENDOR",
  "VARIANT_PRICE",
  "VARIANT_COMPARE_AT_PRICE",
  "VARIANT_WEIGHT",
  "VARIANT_INVENTORY",
  "VARIANT_TITLE",
  "PRODUCT_CATEGORY_ID",
  "PRODUCT_METAFIELD_DEFINITION",
  "VARIANT_METAFIELD_DEFINITION",
  "IS_PRICE_REDUCED",
] as const;

export const COLLECTION_RULE_RELATIONS = [
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "LESS_THAN",
  "STARTS_WITH",
  "ENDS_WITH",
  "CONTAINS",
  "NOT_CONTAINS",
  "IS_SET",
  "IS_NOT_SET",
] as const;

/** Pinned Shopify Admin API version. Single source of truth. */
export const SHOPIFY_API_VERSION = "2026-04" as const;
