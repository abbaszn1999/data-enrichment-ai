import type { PlatformCsvInput } from "@/lib/catalog/platforms/common";
import {
  MAGENTO_IMAGES_MODE,
  SHOPIFY_IMAGES_MODE,
  WOOCOMMERCE_IMAGES_MODE,
  buildMagentoImagesCsv,
  buildShopifyImagesCsv,
  buildWooCommerceImagesCsv,
} from "@/lib/catalog/platforms/images-only";
import { MAGENTO_PLATFORM, buildMagentoCsv } from "@/lib/catalog/platforms/magento";
import { SHOPIFY_PLATFORM, buildShopifyCsv } from "@/lib/catalog/platforms/shopify";
import {
  SHOPIFY_DESCRIPTION_PLATFORM,
  buildShopifyDescriptionCsv,
} from "@/lib/catalog/platforms/shopify-description";
import type { ExportMode, ExportPlatformMode, ExportPlatformOption } from "@/lib/catalog/platforms/types";
import { WOOCOMMERCE_PLATFORM, buildWooCommerceCsv } from "@/lib/catalog/platforms/woocommerce";

/** Store platforms offered in the export wizard, in display order. */
export const EXPORT_PLATFORMS: ExportPlatformOption[] = [SHOPIFY_PLATFORM, WOOCOMMERCE_PLATFORM, MAGENTO_PLATFORM];

export type PlatformId = "shopify" | "woocommerce" | "magento";

type Builder = <Row>(input: PlatformCsvInput<Row>) => Promise<string>;

/** Not every platform has every mode: descriptions with pictures need Shopify's CDN naming. */
const BUILDERS: Record<PlatformId, Partial<Record<ExportMode, Builder>>> = {
  shopify: { products: buildShopifyCsv, images: buildShopifyImagesCsv, description: buildShopifyDescriptionCsv },
  woocommerce: { products: buildWooCommerceCsv, images: buildWooCommerceImagesCsv },
  magento: { products: buildMagentoCsv, images: buildMagentoImagesCsv },
};

const IMAGE_MODES: Record<PlatformId, ExportPlatformMode> = {
  shopify: SHOPIFY_IMAGES_MODE,
  woocommerce: WOOCOMMERCE_IMAGES_MODE,
  magento: MAGENTO_IMAGES_MODE,
};

export function isPlatformId(id: string): id is PlatformId {
  return Object.prototype.hasOwnProperty.call(BUILDERS, id);
}

export function buildPlatformCsv<Row>(
  platform: PlatformId,
  input: PlatformCsvInput<Row>,
  mode: ExportMode = "products"
): Promise<string> {
  const build = BUILDERS[platform][mode];
  if (!build) throw new Error(`${platform} has no "${mode}" export`);
  return build(input);
}

/**
 * Platforms for Gallery: adding pictures to products
 * already in the store comes first, creating new products second.
 */
export const IMAGE_EXPORT_PLATFORMS: ExportPlatformOption[] = EXPORT_PLATFORMS.map((option) => ({
  ...option,
  modes: [
    IMAGE_MODES[option.id as PlatformId],
    {
      id: "products",
      title: "New products",
      description: "Create products from the sheet",
      fields: option.fields,
      guessMapping: option.guessMapping,
      note: option.note,
    },
  ],
}));

/**
 * Platforms for Visualizer: only Shopify, because a description's pictures
 * must end up hosted by the store (see shopify-description.ts).
 */
export const DESCRIPTION_EXPORT_PLATFORMS: ExportPlatformOption[] = [SHOPIFY_DESCRIPTION_PLATFORM];

/** Mapping field that holds the variant option, per platform. */
export const OPTION_FIELD: Record<PlatformId, string> = {
  shopify: "Option1 value",
  woocommerce: "Attribute 1 value(s)",
  magento: "configurable_option",
};
