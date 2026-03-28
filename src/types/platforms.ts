export interface PlatformConfig {
  id: string;
  name: string;
  description: string;
  logo: string;
  fileFormat: "csv" | "xlsx" | "tsv";
  columns: PlatformColumnDef[];
}

export interface PlatformColumnDef {
  platformField: string;
  description: string;
  required: boolean;
  defaultSystemField?: string;
  defaultValue?: string;
  transform?: TransformType;
}

export type TransformType =
  | "html_wrap"
  | "join_comma"
  | "join_newline"
  | "join_pipe"
  | "first_item"
  | "first_image"
  | "all_images"
  | "bullets_html"
  | "strip_html"
  | `truncate_${number}`;

export type SupportedPlatform =
  | "shopify"
  | "woocommerce"
  | "bigcommerce"
  | "salla"
  | "zid"
  | "amazon"
  | "noon"
  | "generic_csv"
  | "generic_xlsx";

export interface ExportOptions {
  platformId: SupportedPlatform;
  includeEnriched: boolean;
  filterByCategory?: string;
  filterByStatus?: string;
  customMapping?: Record<string, string>;
  fileName?: string;
}
