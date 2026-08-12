// Mirror Shopify column names where possible to keep UI provider-agnostic.
export const WOOCOMMERCE_CORE_PRODUCT_COLUMNS = [
  "id",
  "title",
  "handle",
  "status",
  "type",
  "vendor",
  "product_type",
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
  "variant_count",
  "featured_image",
  "featured_image_alt_text",
  // Gallery = every image after the first. `gallery_media` carries the
  // attachment IDs and is hidden from the UI; see core/gallery-images.ts.
  "gallery_images",
  "gallery_media",
  "short_description",
  "body_html",
  "weight",
  "seo_title",
  "seo_description",
  "date_created",
  "date_modified",
] as const;

/** Direct mappings for `POST /products` updates (column → WooCommerce field). */
export const WOO_PRODUCT_FIELD_MAP: Record<string, string> = {
  title: "name",
  handle: "slug",
  status: "status",
  type: "type",
  body_html: "description",
  short_description: "short_description",
  description: "description",
  seo_title: "meta_data:_yoast_wpseo_title",
  seo_description: "meta_data:_yoast_wpseo_metadesc",
};
