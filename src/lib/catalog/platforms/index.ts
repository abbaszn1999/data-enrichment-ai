import type { PlatformCsvInput } from "@/lib/catalog/platforms/common";
import { MAGENTO_PLATFORM, buildMagentoCsv } from "@/lib/catalog/platforms/magento";
import { SHOPIFY_PLATFORM, buildShopifyCsv } from "@/lib/catalog/platforms/shopify";
import type { ExportPlatformOption } from "@/lib/catalog/platforms/types";
import { WOOCOMMERCE_PLATFORM, buildWooCommerceCsv } from "@/lib/catalog/platforms/woocommerce";

/** Store platforms offered in the export wizard, in display order. */
export const EXPORT_PLATFORMS: ExportPlatformOption[] = [SHOPIFY_PLATFORM, WOOCOMMERCE_PLATFORM, MAGENTO_PLATFORM];

export type PlatformId = "shopify" | "woocommerce" | "magento";

const BUILDERS: Record<PlatformId, <Row>(input: PlatformCsvInput<Row>) => Promise<string>> = {
  shopify: buildShopifyCsv,
  woocommerce: buildWooCommerceCsv,
  magento: buildMagentoCsv,
};

export function isPlatformId(id: string): id is PlatformId {
  return Object.prototype.hasOwnProperty.call(BUILDERS, id);
}

export function buildPlatformCsv<Row>(platform: PlatformId, input: PlatformCsvInput<Row>): Promise<string> {
  return BUILDERS[platform](input);
}

/** Mapping field that holds the variant option, per platform. */
export const OPTION_FIELD: Record<PlatformId, string> = {
  shopify: "Option1 value",
  woocommerce: "Attribute 1 value(s)",
  magento: "configurable_option",
};
