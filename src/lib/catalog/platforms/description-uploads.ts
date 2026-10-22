import {
  csvWriter,
  guessMapping,
  toHtml,
  withoutAliases,
  type AliasedField,
  type PlatformCsvInput,
} from "@/lib/catalog/platforms/common";
import { MAGENTO_PLATFORM } from "@/lib/catalog/platforms/magento";
import type { ExportPlatformMode, ExportPlatformOption, ExportPlatformSetting } from "@/lib/catalog/platforms/types";
import { WOOCOMMERCE_PLATFORM } from "@/lib/catalog/platforms/woocommerce";

/**
 * Generated descriptions for WooCommerce and Magento. Unlike Shopify, where a
 * picture's link is known before upload, these stores pick the folder at upload
 * time (WordPress: /wp-content/uploads/<year>/<month>/, Magento: the Media
 * Gallery folder). So the export runs in two steps:
 * 1. "Pictures (ZIP)": the description pictures under stable names.
 * 2. The user uploads them, pastes the link of one, and "Update description"
 *    writes a CSV whose descriptions point into that folder.
 * File names stay as uploaded on both (WordPress only adds -1 on a clash and
 * keeps the original next to a -scaled copy).
 */

/** Description picture names the export creates (see descriptionFileName). */
const PICTURE_NAME = /^vz-[0-9a-f]{20}(?:-scaled|-\d+)?\.(?:png|jpe?g|webp|gif)$/i;

/** Folder of an uploaded description picture, from its link; null when it is not one of ours. */
export function uploadedPicturesFolder(link: string): string | null {
  const url = link.trim().split(/[?#]/)[0];
  const match = url.match(/^(https?:\/\/[^\s]+\/)([^/]+)$/i);
  return match && PICTURE_NAME.test(match[2]) ? match[1] : null;
}

function uploadedLinkSetting(id: string, placeholder: string, hint: string): ExportPlatformSetting {
  return {
    id,
    label: "Link of one picture you uploaded from the ZIP",
    placeholder,
    hint,
    validate: (value) =>
      uploadedPicturesFolder(value)
        ? null
        : "Paste the link of a picture from the ZIP after uploading it (its name starts with vz-)",
  };
}

export const WOOCOMMERCE_UPLOAD_SETTING = "wooUploadedPictureUrl";
export const MAGENTO_UPLOAD_SETTING = "magentoUploadedPictureUrl";

const PICTURES_NOTE_START = "Step 1 of 2. You get a ZIP with every description picture.";

function picturesMode(note: string): ExportPlatformMode {
  return {
    id: "pictures",
    title: "1. Pictures (ZIP)",
    description: "Download the description pictures to upload to your store",
    fields: [],
    guessMapping: () => ({}),
    note: `${PICTURES_NOTE_START} ${note}`,
  };
}

function descriptionMode(
  fields: AliasedField[],
  setting: ExportPlatformSetting,
  note: string
): ExportPlatformMode {
  return {
    id: "description",
    title: "2. Update description",
    description: "After uploading the pictures from step 1",
    fields: withoutAliases(fields),
    settings: [setting],
    guessMapping: (columns) => guessMapping(fields, columns),
    note: `Step 2 of 2. ${note}`,
  };
}

const DESCRIPTION_FIELD: AliasedField = {
  id: "Description",
  label: "Description",
  required: true,
  aliases: ["ai description", "description"],
};

export const WOOCOMMERCE_DESCRIPTION_PLATFORM: ExportPlatformOption = {
  ...WOOCOMMERCE_PLATFORM,
  modes: [
    picturesMode(
      "Upload them in WordPress under Media → Add New Media File, keeping the file names. Then open one in Media → Library and copy its File URL for step 2."
    ),
    descriptionMode(
      [
        {
          id: "SKU",
          label: "SKU",
          required: true,
          hint: "Must match the product in your store.",
          aliases: ["sku", "variant sku", "item code", "رمز المنتج"],
        },
        DESCRIPTION_FIELD,
      ],
      uploadedLinkSetting(
        WOOCOMMERCE_UPLOAD_SETTING,
        "https://your-store.com/wp-content/uploads/2026/10/vz-….png",
        "Media → Library → click a picture from the ZIP → Copy URL to clipboard."
      ),
      'Import under Products → Import with "Update existing products" ticked; products are matched by SKU and only the description changes. Import as an Administrator: WordPress may strip the description\'s styling for other roles. Upload all pictures in the same month as the one you link, since WordPress files uploads by month.'
    ),
  ],
};

export const MAGENTO_DESCRIPTION_PLATFORM: ExportPlatformOption = {
  ...MAGENTO_PLATFORM,
  modes: [
    picturesMode(
      "Upload them all into one folder under Content → Media Gallery (or copy them to pub/media/wysiwyg on the server), keeping the file names. Then copy the link of one for step 2."
    ),
    descriptionMode(
      [
        {
          id: "sku",
          label: "SKU",
          required: true,
          hint: "Must match the product in your store.",
          aliases: ["sku", "variant sku", "item code", "رمز المنتج"],
        },
        DESCRIPTION_FIELD,
      ],
      uploadedLinkSetting(
        MAGENTO_UPLOAD_SETTING,
        "https://your-store.com/media/wysiwyg/vz-….png",
        "Content → Media Gallery → open a picture from the ZIP and copy its link."
      ),
      'Import under System → Data Transfer → Import, entity Products, behavior "Add/Update"; products are matched by SKU and only the description changes.'
    ),
  ],
};

/** README for a pictures-only ZIP, per platform. */
export const PICTURES_README: Record<"woocommerce" | "magento", string> = {
  woocommerce: `How to use these pictures in WooCommerce

1. In WordPress, open Media > Add New Media File and upload every picture
   in the "images" folder. Keep the file names as they are.
2. Open Media > Library, click one of these pictures and copy its File URL.
3. Back in the export window choose WooCommerce > "2. Update description",
   paste that link and export the CSV.
4. Import the CSV under Products > Import with "Update existing products".
`,
  magento: `How to use these pictures in Magento

1. In Magento admin open Content > Media Gallery and upload every picture
   in the "images" folder into one folder (or copy them to
   pub/media/wysiwyg on the server). Keep the file names as they are.
2. Open one of these pictures and copy its link.
3. Back in the export window choose Magento > "2. Update description",
   paste that link and export the CSV.
4. Import the CSV under System > Data Transfer > Import
   (Entity Type: Products, Import Behavior: Add/Update).
`,
};

function descriptionRows<Row>(input: PlatformCsvInput<Row>, skuField: string) {
  const { mapping, text } = input;
  const rows: { sku: string; description: string }[] = [];
  for (const members of input.products) {
    for (const row of members) {
      const sku = mapping[skuField] ? text(row, mapping[skuField]).trim() : "";
      const description = mapping.Description ? toHtml(text(row, mapping.Description)) : "";
      if (sku && description) rows.push({ sku, description });
    }
  }
  return rows;
}

/** SKU + Description only: WooCommerce leaves every other field as it is. */
export async function buildWooCommerceDescriptionCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  const csv = csvWriter(["SKU", "Description"]);
  for (const row of descriptionRows(input, "SKU")) csv.push({ SKU: row.sku, Description: row.description });
  await input.onProduct?.();
  return "﻿" + csv.toString();
}

/** sku + description only: Magento's Add/Update changes just the columns present. */
export async function buildMagentoDescriptionCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  const csv = csvWriter(["sku", "description"]);
  for (const row of descriptionRows(input, "sku")) csv.push({ sku: row.sku, description: row.description });
  await input.onProduct?.();
  return csv.toString();
}
