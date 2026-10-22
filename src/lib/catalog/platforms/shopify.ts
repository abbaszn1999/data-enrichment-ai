import {
  csvWriter,
  fitLength,
  guessMapping,
  isImportableImage,
  slugify,
  toHtml,
  toPlainNumber,
  toWholeNumber,
  uniqueNamer,
  withoutAliases,
  type AliasedField,
  type PlatformCsvInput,
} from "@/lib/catalog/platforms/common";
import type { ExportPlatformOption } from "@/lib/catalog/platforms/types";

/**
 * Shopify product CSV (Products → Import), using the current template headers
 * (help.shopify.com/csv/product_template.csv). One product spans several lines
 * sharing a URL handle: the first carries the product fields, each variant adds
 * a line, and every extra picture adds a line with only the handle + image.
 * Shopify downloads each Product image URL during the import, so links only
 * need to stay valid until then.
 */

export const SHOPIFY_FIELDS: AliasedField[] = [
  {
    id: "URL handle",
    label: "URL handle",
    hint: "Matches existing products. Left empty, it is made from the title.",
    aliases: ["url handle", "handle", "url key", "slug"],
  },
  {
    id: "Title",
    label: "Title",
    required: true,
    aliases: ["title", "name", "product name", "product title", "اسم المنتج", "الاسم"],
  },
  {
    id: "Description",
    label: "Description",
    aliases: ["description", "body html", "body", "long description", "product description", "الوصف"],
  },
  { id: "Vendor", label: "Vendor", aliases: ["vendor", "brand", "manufacturer", "الماركة", "العلامة التجارية"] },
  { id: "Type", label: "Product type", aliases: ["type", "product type", "category", "الفئة", "التصنيف"] },
  {
    id: "Tags",
    label: "Tags",
    hint: "Comma separated, up to 250.",
    aliases: ["tags", "keywords"],
  },
  {
    id: "Collection",
    label: "Collection",
    hint: "Adds the product to this collection by name.",
    aliases: ["collection", "collections"],
  },
  {
    id: "Option1 value",
    label: "Variant option",
    hint: "e.g. Size or Color. The column name becomes the option name.",
    aliases: ["option1 value", "size", "color", "colour", "variant", "المقاس", "اللون"],
  },
  { id: "SKU", label: "SKU", aliases: ["sku", "variant sku", "item code", "رمز المنتج"] },
  { id: "Price", label: "Price", aliases: ["price", "variant price", "sale price", "السعر"] },
  {
    id: "Compare-at price",
    label: "Compare-at price",
    aliases: ["compare at price", "variant compare at price", "regular price", "msrp", "rrp"],
  },
  {
    id: "Variant Barcodes",
    label: "Barcode",
    aliases: ["barcode", "barcodes", "variant barcode", "ean", "upc", "gtin"],
  },
  {
    id: "Weight value (grams)",
    label: "Weight (grams)",
    hint: "Whole grams, e.g. 1.5 kg = 1500.",
    aliases: ["weight value grams", "grams", "variant grams", "weight"],
  },
  {
    id: "Inventory quantity",
    label: "Inventory",
    hint: "Single-location stores only. Turns on inventory tracking.",
    aliases: ["inventory quantity", "inventory", "variant inventory qty", "stock", "qty", "quantity"],
  },
  {
    id: "Product image URL",
    label: "Images",
    hint: "Every https link in the cell becomes a product picture.",
    aliases: ["product image url", "image src", "image urls", "images", "image", "image url", "picture", "pictures", "photo", "photos"],
  },
  { id: "Image alt text", label: "Image alt text", aliases: ["image alt text", "alt text", "alt"] },
  { id: "SEO title", label: "SEO title", hint: "Up to 70 characters.", aliases: ["seo title", "meta title"] },
  {
    id: "SEO description",
    label: "SEO description",
    hint: "Up to 320 characters.",
    aliases: ["seo description", "meta description"],
  },
];

export const SHOPIFY_PLATFORM: ExportPlatformOption = {
  id: "shopify",
  title: "Shopify",
  description: "Product CSV for Shopify admin → Products → Import",
  fields: withoutAliases(SHOPIFY_FIELDS),
  guessMapping: (columns) => guessMapping(SHOPIFY_FIELDS, columns),
  note:
    "Image links stay valid for 7 days: import the file in Shopify before then, without re-saving it in Excel. To update products already in your store, map URL handle and tick \"Overwrite products with matching handles\".",
};

const LIMITS: Record<string, number> = { "SEO title": 70, "SEO description": 320, "Image alt text": 512 };
const PRICE_FIELDS = new Set(["Price", "Compare-at price"]);
const WHOLE_FIELDS = new Set(["Weight value (grams)", "Inventory quantity"]);
const PRODUCT_FIELDS = ["Title", "Description", "Vendor", "Type", "Tags", "SEO title", "SEO description", "Collection"];
const VARIANT_FIELDS = ["SKU", "Variant Barcodes", "Price", "Compare-at price", "Weight value (grams)"];
/** Columns Shopify needs once inventory is tracked (tracker "shopify"). */
const INVENTORY_FIELDS = [
  "Inventory tracker",
  "Inventory quantity",
  "Continue selling when out of stock",
  "Fulfillment service",
];

export async function buildShopifyCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  const { products, mapping, text, images, onProduct } = input;
  const mapped = (field: string) => Boolean(mapping[field]);
  const value = (row: Row, field: string): string => {
    const key = mapping[field];
    if (!key) return "";
    const raw = text(row, key).trim();
    if (field === "Description") return toHtml(raw);
    if (field === "Tags") return raw.split(/\s*[\n,]\s*/).filter(Boolean).slice(0, 250).join(", ");
    if (PRICE_FIELDS.has(field)) return toPlainNumber(raw);
    if (WHOLE_FIELDS.has(field)) return toWholeNumber(raw);
    const flat = raw.replace(/\s*\n\s*/g, " ");
    return LIMITS[field] ? fitLength(flat, LIMITS[field]) : flat;
  };

  // Only mapped fields get a column: on "overwrite products with matching
  // handles", Shopify blanks any included column left empty.
  const tracksInventory = mapped("Inventory quantity");
  const headers = [
    "Title",
    "URL handle",
    ...PRODUCT_FIELDS.filter((field) => field !== "Title" && mapped(field)),
    "Option1 name",
    "Option1 value",
    ...VARIANT_FIELDS.filter(mapped),
    ...(tracksInventory ? INVENTORY_FIELDS : []),
    ...(mapped("Product image URL") ? ["Product image URL", "Image position", "Image alt text"] : []),
  ];
  const csv = csvWriter(headers);
  const push = csv.push;
  const uniqueHandle = uniqueNamer();
  for (const [productIndex, members] of products.entries()) {
    const primary = members[0];
    if (!primary) continue;
    const handle = uniqueHandle(
      slugify(value(primary, "URL handle")) || slugify(value(primary, "Title")) || `product-${productIndex + 1}`
    );

    // A single variant with no option value is Shopify's "Default Title".
    const optionValues = members.map((row) => value(row, "Option1 value"));
    const hasOption = mapped("Option1 value") && optionValues.some(Boolean);
    const singleDefault = members.length === 1 && !hasOption;
    const optionName = singleDefault ? "Title" : hasOption ? input.optionName || "Option" : "Variant";

    const pictures = mapped("Product image URL")
      ? [...new Set(members.flatMap((row) => images(row, mapping["Product image URL"])))].filter(isImportableImage).slice(0, 250)
      : [];
    const altText = fitLength(value(primary, "Image alt text") || value(primary, "Title"), 512);

    for (const [variantIndex, row] of members.entries()) {
      const cells: Record<string, string> = { "URL handle": handle };
      if (variantIndex === 0) {
        for (const field of PRODUCT_FIELDS) cells[field] = value(row, field);
        cells["Option1 name"] = optionName;
      }
      cells["Option1 value"] = singleDefault
        ? "Default Title"
        : hasOption
          ? optionValues[variantIndex] || `Option ${variantIndex + 1}`
          : value(row, "SKU") || `Variant ${variantIndex + 1}`;
      for (const field of VARIANT_FIELDS) cells[field] = value(row, field);
      if (tracksInventory) {
        cells["Inventory tracker"] = "shopify";
        cells["Inventory quantity"] = value(row, "Inventory quantity") || "0";
        cells["Continue selling when out of stock"] = "deny";
        cells["Fulfillment service"] = "manual";
      }
      const picture = pictures[variantIndex];
      if (picture) {
        cells["Product image URL"] = picture;
        cells["Image position"] = String(variantIndex + 1);
        cells["Image alt text"] = altText;
      }
      push(cells);
    }
    for (let i = members.length; i < pictures.length; i += 1) {
      push({
        "URL handle": handle,
        "Product image URL": pictures[i],
        "Image position": String(i + 1),
        "Image alt text": altText,
      });
    }
    await onProduct?.();
  }
  return csv.toString();
}
