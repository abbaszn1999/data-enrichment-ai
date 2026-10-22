import {
  csvWriter,
  fitLength,
  guessMapping,
  isImportableImage,
  withoutAliases,
  type AliasedField,
  type PlatformCsvInput,
} from "@/lib/catalog/platforms/common";
import type { ExportPlatformMode } from "@/lib/catalog/platforms/types";

/**
 * "Add images to existing products": a file that names each product and lists
 * pictures, and leaves every other field in the store alone. Each platform
 * treats pictures on an existing product differently (researched against the
 * official docs and importer behaviour):
 * - Shopify: only the included columns are touched, so no Option columns —
 *   they would reset the product's variants. Title + URL handle are required.
 * - WooCommerce: Images replaces the featured image and gallery, so the main
 *   picture goes first to stay featured.
 * - Magento: additional_images is added to what is there; base_image is left
 *   alone. Importing the same file twice adds the pictures twice.
 */

const IDENTITY_HINT = "Must match the product in your store exactly.";
const MAIN_IMAGE: AliasedField = {
  id: "main_image",
  label: "Main image",
  hint: "Kept first so it stays the product's main picture.",
  aliases: ["main image", "product image url", "image src", "image url", "image", "picture", "photo"],
};
const NEW_IMAGES: AliasedField = {
  id: "new_images",
  label: "New images",
  required: true,
  hint: "Every https link in the cell is added to the product.",
  aliases: ["gallery images", "images", "image urls", "additional images"],
};

const SHOPIFY_FIELDS: AliasedField[] = [
  { id: "URL handle", label: "URL handle", required: true, hint: IDENTITY_HINT, aliases: ["url handle", "handle", "slug"] },
  {
    id: "Title",
    label: "Title",
    required: true,
    hint: "Shopify requires it when updating.",
    aliases: ["title", "name", "product name", "product title", "اسم المنتج", "الاسم"],
  },
  MAIN_IMAGE,
  NEW_IMAGES,
  { id: "Image alt text", label: "Image alt text", aliases: ["image alt text", "alt text", "alt"] },
];

const WOOCOMMERCE_FIELDS: AliasedField[] = [
  { id: "SKU", label: "SKU", required: true, hint: IDENTITY_HINT, aliases: ["sku", "variant sku", "item code", "رمز المنتج"] },
  MAIN_IMAGE,
  NEW_IMAGES,
];

const MAGENTO_FIELDS: AliasedField[] = [
  { id: "sku", label: "SKU", required: true, hint: IDENTITY_HINT, aliases: ["sku", "variant sku", "item code", "رمز المنتج"] },
  NEW_IMAGES,
  { id: "image_label", label: "Image label", aliases: ["image alt text", "alt text", "alt", "image label", "name", "title"] },
];

function imagesMode(fields: AliasedField[], note: string): ExportPlatformMode {
  return {
    id: "images",
    title: "Add images",
    description: "To products already in your store",
    fields: withoutAliases(fields),
    guessMapping: (columns) => guessMapping(fields, columns),
    note,
  };
}

const LINK_NOTE = "Image links stay valid for 7 days: import before then, without re-saving the file in Excel.";

export const SHOPIFY_IMAGES_MODE = imagesMode(
  SHOPIFY_FIELDS,
  `${LINK_NOTE} In Shopify, tick "Overwrite products with matching handles". Only the title and pictures are written; prices, descriptions and variants stay as they are. Try one product first: Shopify may keep the pictures it already has next to the new ones.`
);
export const WOOCOMMERCE_IMAGES_MODE = imagesMode(
  WOOCOMMERCE_FIELDS,
  `${LINK_NOTE} Tick "Update existing products". WooCommerce replaces the product's pictures with this list, so map Main image to keep it as the featured picture.`
);
export const MAGENTO_IMAGES_MODE = imagesMode(
  MAGENTO_FIELDS,
  `${LINK_NOTE} Use Import Behavior "Add/Update". The new pictures are added after the existing ones; importing the same file twice adds them twice.`
);

/** Main picture first, then the new ones, without repeats or non-https links. */
function picturesFor<Row>(input: PlatformCsvInput<Row>, row: Row): string[] {
  const { mapping, images } = input;
  const main = mapping.main_image ? images(row, mapping.main_image).slice(0, 1) : [];
  const added = mapping.new_images ? images(row, mapping.new_images) : [];
  return [...new Set([...main, ...added])].filter(isImportableImage);
}

function cell<Row>(input: PlatformCsvInput<Row>, row: Row, field: string): string {
  const key = input.mapping[field];
  return key ? input.text(row, key).replace(/\s*\n\s*/g, " ").trim() : "";
}

/** Rows without an identity or a picture are left out: they could only create a stray product. */
export async function buildShopifyImagesCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  const csv = csvWriter(["Title", "URL handle", "Product image URL", "Image position", "Image alt text"]);
  for (const members of input.products) {
    for (const row of members) {
      const handle = cell(input, row, "URL handle");
      const title = cell(input, row, "Title");
      const pictures = picturesFor(input, row).slice(0, 250);
      if (!handle || pictures.length === 0) continue;
      const alt = fitLength(cell(input, row, "Image alt text") || title, 512);
      pictures.forEach((url, index) =>
        csv.push({
          Title: index === 0 ? title : "",
          "URL handle": handle,
          "Product image URL": url,
          "Image position": String(index + 1),
          "Image alt text": alt,
        })
      );
    }
    await input.onProduct?.();
  }
  return csv.toString();
}

export async function buildWooCommerceImagesCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  const csv = csvWriter(["SKU", "Images"]);
  for (const members of input.products) {
    for (const row of members) {
      const sku = cell(input, row, "SKU");
      const pictures = picturesFor(input, row);
      if (sku && pictures.length > 0) csv.push({ SKU: sku, Images: pictures.join(", ") });
    }
    await input.onProduct?.();
  }
  return "﻿" + csv.toString();
}

export async function buildMagentoImagesCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  const csv = csvWriter(["sku", "additional_images", "additional_image_labels"]);
  for (const members of input.products) {
    for (const row of members) {
      const sku = cell(input, row, "sku");
      // Commas separate the list, so they can't appear inside a URL or label.
      const pictures = picturesFor(input, row).map((url) => url.replace(/,/g, "%2C"));
      if (!sku || pictures.length === 0) continue;
      const label = cell(input, row, "image_label").replace(/,/g, " ");
      csv.push({
        sku,
        additional_images: pictures.join(","),
        additional_image_labels: label ? pictures.map(() => label).join(",") : "",
      });
    }
    await input.onProduct?.();
  }
  return csv.toString();
}
