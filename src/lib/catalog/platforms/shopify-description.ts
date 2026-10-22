import {
  csvWriter,
  fitLength,
  guessMapping,
  isImportableImage,
  slugify,
  toHtml,
  withoutAliases,
  type AliasedField,
  type PlatformCsvInput,
} from "@/lib/catalog/platforms/common";
import { SHOPIFY_PLATFORM } from "@/lib/catalog/platforms/shopify";
import type { ExportPlatformMode, ExportPlatformOption, ExportPlatformSetting } from "@/lib/catalog/platforms/types";

/**
 * Generated descriptions for Shopify. A store keeps a description's HTML as it
 * is and never copies pictures it links to, so a description pointing at our
 * expiring links would break. Instead each picture gets a unique file name and
 * is also listed as a product image: Shopify downloads it during the import and
 * keeps that file name on its CDN, under a prefix that is fixed per store. The
 * description can therefore point at the CDN link before the import runs:
 *   https://cdn.shopify.com/s/files/1/0832/7305/6474/files/<unique name>
 * The "files" variant leaves product images alone: the pictures come in a ZIP
 * that the user uploads to Content → Files, which keeps file names the same way.
 */

export const SHOPIFY_FILES_SETTING = "shopifyFilesUrl";

/** Store CDN folder from any picture link of that store; null when the link is not one. */
export function shopifyFilesPrefix(link: string): string | null {
  const url = link.trim().split(/[?#]/)[0];
  const cdn = url.match(/^(https:\/\/cdn\.shopify\.com\/s\/files\/1\/(?:\d+\/)+files\/)[^/]+$/i);
  if (cdn) return cdn[1];
  // Pictures served through the store's own domain: https://shop.com/cdn/shop/files/name.jpg
  const own = url.match(/^(https:\/\/[^/]+\/cdn\/shop\/files\/)[^/]+$/i);
  return own ? own[1] : null;
}

const FILES_SETTING: ExportPlatformSetting = {
  id: SHOPIFY_FILES_SETTING,
  label: "Link of any picture in your Shopify store",
  placeholder: "https://cdn.shopify.com/s/files/1/…/files/picture.jpg",
  hint: "Open any product in Shopify, right-click a picture → Copy image address. It tells us where your store keeps pictures.",
  validate: (value) =>
    shopifyFilesPrefix(value) ? null : "Paste a picture link from your store (cdn.shopify.com/s/files/… or …/cdn/shop/files/…)",
};

/** Mapping field the export route fills with the description's pictures (one per line). */
export const DESCRIPTION_IMAGES_FIELD = "description_images";

const FIELDS: AliasedField[] = [
  {
    id: "URL handle",
    label: "URL handle",
    required: true,
    hint: "Must match the product in your store.",
    aliases: ["url handle", "handle", "slug"],
  },
  {
    id: "Title",
    label: "Title",
    required: true,
    hint: "Shopify requires it when updating.",
    aliases: ["title", "name", "product name", "product title", "اسم المنتج", "الاسم"],
  },
  {
    id: "Description",
    label: "Description",
    required: true,
    aliases: ["ai description", "description"],
  },
  {
    id: "main_image",
    label: "Main image",
    hint: "Kept first so it stays the product's main picture.",
    aliases: ["main image", "product image url", "image src", "image url", "image", "picture", "photo"],
  },
  {
    id: "Option1 value",
    label: "Variant option",
    hint: "Only for products with variants: the first variant's value (e.g. Small). The column name becomes the option name.",
    aliases: ["option1 value", "size", "color", "colour", "المقاس", "اللون"],
  },
];

const NOTE =
  'In Shopify, tick "Overwrite products with matching handles". Only the title, description and pictures are written. The description\'s pictures are added to the product\'s images too: that is how Shopify gets a copy to show in the description. Import within 7 days and without re-saving the file in Excel. Safe for products without variants.';

const DESCRIPTION_MODE: ExportPlatformMode = {
  id: "description",
  title: "Update description + images",
  description: "Pictures are also added to the product's images",
  fields: withoutAliases(FIELDS),
  settings: [FILES_SETTING],
  guessMapping: (columns) => guessMapping(FIELDS, columns),
  note: NOTE,
};

const FILES_NOTE =
  'You get a ZIP: first upload everything in its images folder to Shopify → Content → Files, then import the CSV with "Overwrite products with matching handles" ticked. Only the title and description are written; product images stay as they are. Keep the file names unchanged. Safe for products without variants.';

const DESCRIPTION_FILES_MODE: ExportPlatformMode = {
  id: "description_files",
  title: "Update description",
  description: "Pictures go to Shopify Files (ZIP); product images stay as they are",
  fields: withoutAliases(FIELDS.filter((field) => field.id !== "main_image")),
  settings: [FILES_SETTING],
  guessMapping: (columns) => {
    const mapping = guessMapping(FIELDS, columns);
    delete mapping.main_image;
    return mapping;
  },
  note: FILES_NOTE,
};

/** The generated description is the product description in a new-product file too. */
const PRODUCTS_MODE: ExportPlatformMode = {
  id: "products",
  title: "New products",
  description: "Create products from the sheet",
  fields: SHOPIFY_PLATFORM.fields.filter((field) => field.id !== "Product image URL"),
  settings: [FILES_SETTING],
  guessMapping: (columns) => {
    const mapping = SHOPIFY_PLATFORM.guessMapping(columns);
    const generated = columns.find((column) => column.key === "AI Description");
    if (generated) mapping.Description = generated.key;
    delete mapping["Product image URL"];
    return mapping;
  },
  note: "The description's pictures become the product's images. Import within 7 days and without re-saving the file in Excel.",
};

export const SHOPIFY_DESCRIPTION_PLATFORM: ExportPlatformOption = {
  ...SHOPIFY_PLATFORM,
  description: "Product CSV for Shopify admin → Products → Import",
  modes: [DESCRIPTION_FILES_MODE, DESCRIPTION_MODE, PRODUCTS_MODE],
};

/** Title, handle, description and pictures; options as Shopify needs them on an update. */
export function buildShopifyDescriptionCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  return buildDescriptionCsv(input, true);
}

/**
 * Title, handle and description only. No image columns at all: an included but
 * empty image column would clear the product's pictures on overwrite.
 */
export function buildShopifyDescriptionOnlyCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  return buildDescriptionCsv(input, false);
}

async function buildDescriptionCsv<Row>(input: PlatformCsvInput<Row>, withPictures: boolean): Promise<string> {
  const { mapping, text, images } = input;
  const csv = csvWriter([
    "Title",
    "URL handle",
    "Description",
    "Option1 name",
    "Option1 value",
    ...(withPictures ? ["Product image URL", "Image position", "Image alt text"] : []),
  ]);
  const cell = (row: Row, field: string) => {
    const key = mapping[field];
    return key ? text(row, key).replace(/\s*\n\s*/g, " ").trim() : "";
  };
  for (const members of input.products) {
    for (const row of members) {
      const handle = slugify(cell(row, "URL handle"));
      if (!handle) continue;
      const title = cell(row, "Title");
      const descriptionKey = mapping.Description;
      const description = descriptionKey ? toHtml(text(row, descriptionKey)) : "";
      const option = mapping["Option1 value"] ? cell(row, "Option1 value") : "";
      const main = withPictures && mapping.main_image ? images(row, mapping.main_image).slice(0, 1) : [];
      const added =
        withPictures && mapping[DESCRIPTION_IMAGES_FIELD] ? images(row, mapping[DESCRIPTION_IMAGES_FIELD]) : [];
      const pictures = [...new Set([...main, ...added])].filter(isImportableImage).slice(0, 250);
      const alt = fitLength(title, 512);
      const lines = Math.max(1, pictures.length);
      for (let index = 0; index < lines; index += 1) {
        csv.push({
          Title: index === 0 ? title : "",
          "URL handle": handle,
          Description: index === 0 ? description : "",
          "Option1 name": index === 0 ? (option ? input.optionName || "Option" : "Title") : "",
          "Option1 value": index === 0 ? option || "Default Title" : "",
          "Product image URL": pictures[index] ?? "",
          "Image position": pictures[index] ? String(index + 1) : "",
          "Image alt text": pictures[index] ? alt : "",
        });
      }
    }
    await input.onProduct?.();
  }
  return csv.toString();
}
