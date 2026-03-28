export interface PlatformFormat {
  id: string;
  name: string;
  description: string;
  fileFormat: "csv" | "xlsx" | "tsv";
  columns: PlatformColumn[];
}

export interface PlatformColumn {
  platformField: string;
  description: string;
  required: boolean;
  defaultSystemField?: string;
  defaultValue?: string;
  transform?: string;
}

export const PLATFORM_FORMATS: PlatformFormat[] = [
  {
    id: "shopify",
    name: "Shopify",
    description: "Standard Shopify product CSV format",
    fileFormat: "csv",
    columns: [
      { platformField: "Handle", description: "URL-friendly product handle", required: true, defaultSystemField: "sku" },
      { platformField: "Title", description: "Product title", required: true, defaultSystemField: "name" },
      { platformField: "Body (HTML)", description: "Product description in HTML", required: false, defaultSystemField: "description", transform: "html_wrap" },
      { platformField: "Vendor", description: "Brand or vendor name", required: false, defaultSystemField: "brand" },
      { platformField: "Type", description: "Product type/category", required: false, defaultSystemField: "category" },
      { platformField: "Tags", description: "Comma-separated tags", required: false, defaultSystemField: "tags" },
      { platformField: "Published", description: "Is product published", required: false, defaultValue: "TRUE" },
      { platformField: "Variant SKU", description: "Variant SKU code", required: true, defaultSystemField: "sku" },
      { platformField: "Variant Price", description: "Product price", required: true, defaultSystemField: "price" },
      { platformField: "Variant Inventory Qty", description: "Stock quantity", required: false, defaultSystemField: "stock" },
      { platformField: "Image Src", description: "Main image URL", required: false, defaultSystemField: "image_url" },
    ],
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    description: "Standard WooCommerce product CSV format",
    fileFormat: "csv",
    columns: [
      { platformField: "SKU", description: "Product SKU", required: true, defaultSystemField: "sku" },
      { platformField: "Name", description: "Product name", required: true, defaultSystemField: "name" },
      { platformField: "Short description", description: "Brief description", required: false, defaultSystemField: "description" },
      { platformField: "Regular price", description: "Product price", required: true, defaultSystemField: "price" },
      { platformField: "Stock", description: "Stock quantity", required: false, defaultSystemField: "stock" },
      { platformField: "Categories", description: "Pipe-separated categories", required: false, defaultSystemField: "category", transform: "join_pipe" },
      { platformField: "Images", description: "Comma-separated image URLs", required: false, defaultSystemField: "image_url" },
    ],
  },
  {
    id: "salla",
    name: "Salla",
    description: "Salla e-commerce platform format",
    fileFormat: "csv",
    columns: [
      { platformField: "SKU", description: "Product SKU", required: true, defaultSystemField: "sku" },
      { platformField: "product_name", description: "Product name", required: true, defaultSystemField: "name" },
      { platformField: "description", description: "Product description", required: false, defaultSystemField: "description" },
      { platformField: "price", description: "Product price", required: true, defaultSystemField: "price" },
      { platformField: "quantity", description: "Stock quantity", required: false, defaultSystemField: "stock" },
      { platformField: "category", description: "Category name", required: false, defaultSystemField: "category" },
      { platformField: "images", description: "Image URLs", required: false, defaultSystemField: "image_url" },
      { platformField: "brand", description: "Brand name", required: false, defaultSystemField: "brand" },
    ],
  },
  {
    id: "zid",
    name: "Zid",
    description: "Zid e-commerce platform format",
    fileFormat: "xlsx",
    columns: [
      { platformField: "sku", description: "Product SKU", required: true, defaultSystemField: "sku" },
      { platformField: "name", description: "Product name", required: true, defaultSystemField: "name" },
      { platformField: "description", description: "Product description", required: false, defaultSystemField: "description" },
      { platformField: "price", description: "Product price", required: true, defaultSystemField: "price" },
      { platformField: "quantity", description: "Stock quantity", required: false, defaultSystemField: "stock" },
      { platformField: "category_name", description: "Category name", required: false, defaultSystemField: "category" },
      { platformField: "image_url", description: "Image URL", required: false, defaultSystemField: "image_url" },
      { platformField: "brand", description: "Brand name", required: false, defaultSystemField: "brand" },
      { platformField: "weight", description: "Product weight", required: false, defaultSystemField: "weight" },
    ],
  },
  {
    id: "amazon",
    name: "Amazon Seller Central",
    description: "Amazon flat file template",
    fileFormat: "tsv",
    columns: [
      { platformField: "item_sku", description: "Product SKU", required: true, defaultSystemField: "sku" },
      { platformField: "item_name", description: "Product title", required: true, defaultSystemField: "name" },
      { platformField: "product_description", description: "Product description", required: false, defaultSystemField: "description" },
      { platformField: "brand_name", description: "Brand name", required: true, defaultSystemField: "brand" },
      { platformField: "standard_price", description: "Product price", required: true, defaultSystemField: "price" },
      { platformField: "quantity", description: "Stock quantity", required: false, defaultSystemField: "stock" },
      { platformField: "main_image_url", description: "Main image URL", required: false, defaultSystemField: "image_url" },
    ],
  },
  {
    id: "noon",
    name: "Noon",
    description: "Noon marketplace format",
    fileFormat: "xlsx",
    columns: [
      { platformField: "Partner SKU", description: "Product SKU", required: true, defaultSystemField: "sku" },
      { platformField: "Product Title", description: "Product title", required: true, defaultSystemField: "name" },
      { platformField: "Product Description", description: "Product description", required: false, defaultSystemField: "description" },
      { platformField: "Brand", description: "Brand name", required: true, defaultSystemField: "brand" },
      { platformField: "Sale Price", description: "Sale price", required: true, defaultSystemField: "price" },
      { platformField: "Image 1", description: "Main image URL", required: false, defaultSystemField: "image_url" },
    ],
  },
  {
    id: "generic_csv",
    name: "Generic CSV",
    description: "Custom CSV export",
    fileFormat: "csv",
    columns: [],
  },
  {
    id: "generic_xlsx",
    name: "Generic XLSX",
    description: "Custom Excel export",
    fileFormat: "xlsx",
    columns: [],
  },
];

export function getPlatformFormat(platformId: string): PlatformFormat | undefined {
  return PLATFORM_FORMATS.find((p) => p.id === platformId);
}
