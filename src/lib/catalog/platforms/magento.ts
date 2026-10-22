import {
  csvWriter,
  fitLength,
  guessMapping,
  isImportableImage,
  listItems,
  slugify,
  toHtml,
  toPlainNumber,
  uniqueNamer,
  withoutAliases,
  type AliasedField,
  type PlatformCsvInput,
} from "@/lib/catalog/platforms/common";
import type { ExportPlatformOption } from "@/lib/catalog/platforms/types";

/**
 * Magento 2 / Adobe Commerce product import (System → Data Transfer → Import,
 * entity "Products"), headers as in Magento's own catalog_product.csv sample.
 * Every row needs sku, attribute_set_code, product_type, product_websites,
 * name and price to create a product. Variants become simple products
 * ("Not Visible Individually") followed by a configurable parent that lists
 * them in configurable_variations. Magento downloads full image URLs itself.
 */

export const MAGENTO_FIELDS: AliasedField[] = [
  {
    id: "sku",
    label: "SKU",
    hint: "Matches existing products. Left empty, one is made from the name.",
    aliases: ["sku", "variant sku", "item code", "رمز المنتج"],
  },
  {
    id: "name",
    label: "Name",
    required: true,
    aliases: ["name", "title", "product name", "product title", "اسم المنتج", "الاسم"],
  },
  {
    id: "price",
    label: "Price",
    required: true,
    aliases: ["price", "regular price", "variant price", "السعر"],
  },
  { id: "special_price", label: "Special price", aliases: ["special price", "sale price", "discount price"] },
  {
    id: "description",
    label: "Description",
    aliases: ["description", "body html", "body", "long description", "product description", "الوصف"],
  },
  {
    id: "short_description",
    label: "Short description",
    aliases: ["short description", "summary", "excerpt", "الوصف المختصر"],
  },
  {
    id: "categories",
    label: "Categories",
    hint: "Full path, e.g. Gear/Bags. Default Category/ is added in front when missing.",
    aliases: ["categories", "category", "product category", "الفئة", "التصنيف"],
  },
  {
    id: "configurable_option",
    label: "Variant option",
    hint: "The column name must be a Magento attribute code (e.g. color, size) usable for configurable products.",
    aliases: ["size", "color", "colour", "variant", "المقاس", "اللون"],
  },
  { id: "weight", label: "Weight", hint: "In your store's weight unit.", aliases: ["weight", "grams"] },
  { id: "qty", label: "Quantity", aliases: ["qty", "quantity", "stock", "inventory", "inventory quantity"] },
  {
    id: "images",
    label: "Images",
    hint: "First https link becomes the base, small and thumbnail image; the rest are additional.",
    aliases: ["images", "image urls", "image src", "image", "image url", "picture", "pictures", "photo", "photos"],
  },
  { id: "base_image_label", label: "Image label", aliases: ["image alt text", "alt text", "alt", "image label"] },
  { id: "url_key", label: "URL key", hint: "Left empty, it is made from the name.", aliases: ["url key", "handle", "slug"] },
  { id: "meta_title", label: "Meta title", aliases: ["meta title", "seo title"] },
  { id: "meta_keywords", label: "Meta keywords", aliases: ["meta keywords", "keywords", "tags"] },
  { id: "meta_description", label: "Meta description", aliases: ["meta description", "seo description"] },
];

export const MAGENTO_PLATFORM: ExportPlatformOption = {
  id: "magento",
  title: "Magento (Adobe Commerce)",
  description: "Product CSV for System → Data Transfer → Import → Products",
  fields: withoutAliases(MAGENTO_FIELDS),
  guessMapping: (columns) => guessMapping(MAGENTO_FIELDS, columns),
  note:
    "Image links stay valid for 7 days: import before then, without re-saving the file in Excel. Choose Import Behavior \"Add/Update\"; products are matched by SKU, and categories in the file are created if missing.",
};

const SKU_MAX = 64;
/** Fields copied as they are (after cleanup) onto each product row. */
const TEXT_FIELDS = ["description", "short_description", "meta_title", "meta_keywords", "meta_description"];

/** Values inside additional_attributes / configurable_variations can't hold separators. */
function attributeValue(value: string): string {
  return value.replace(/[,=|]/g, " ").replace(/\s+/g, " ").trim();
}

/** "Gear > Bags" → "Default Category/Gear/Bags". */
function categoryPath(path: string): string {
  const parts = path.split(/\s*[>/]\s*/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts[0].toLowerCase() !== "default category") parts.unshift("Default Category");
  return parts.join("/");
}

export async function buildMagentoCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  const { products, mapping, text, images, onProduct } = input;
  const mapped = (field: string) => Boolean(mapping[field]);
  const value = (row: Row, field: string): string => {
    const key = mapping[field];
    if (!key) return "";
    const raw = text(row, key).trim();
    if (field === "description" || field === "short_description") return toHtml(raw);
    if (field === "price" || field === "special_price" || field === "weight" || field === "qty") return toPlainNumber(raw);
    if (field === "categories") return listItems(raw).map(categoryPath).filter(Boolean).join(",");
    if (field === "meta_keywords") return listItems(raw).join(", ");
    const flat = raw.replace(/\s*\n\s*/g, " ");
    return field === "meta_title" || field === "meta_description" ? fitLength(flat, 255) : flat;
  };

  // Variants need a real attribute code taken from the option column's name.
  const attributeCode = mapped("configurable_option")
    ? slugify(input.optionName || "").replace(/-/g, "_")
    : "";
  const hasConfigurables = Boolean(attributeCode) && products.some((members) => members.length > 1);
  const headers = [
    "sku",
    "attribute_set_code",
    "product_type",
    ...(mapped("categories") ? ["categories"] : []),
    "product_websites",
    "name",
    ...TEXT_FIELDS.slice(0, 2).filter(mapped),
    ...(mapped("weight") ? ["weight"] : []),
    "product_online",
    "visibility",
    "price",
    ...(mapped("special_price") ? ["special_price"] : []),
    "url_key",
    ...TEXT_FIELDS.slice(2).filter(mapped),
    ...(mapped("images")
      ? ["base_image", "base_image_label", "small_image", "small_image_label", "thumbnail_image", "thumbnail_image_label", "additional_images"]
      : []),
    ...(mapped("qty") ? ["qty", "is_in_stock"] : []),
    ...(hasConfigurables ? ["additional_attributes", "configurable_variations", "configurable_variation_labels"] : []),
  ];
  const csv = csvWriter(headers);
  const uniqueSku = uniqueNamer();
  const uniqueUrlKey = uniqueNamer();

  const productRow = (row: Row, extra: Record<string, string>, pictures: string[], name: string) => {
    const label = value(row, "base_image_label") || name;
    const cells: Record<string, string> = {
      attribute_set_code: "Default",
      product_type: "simple",
      categories: value(row, "categories"),
      product_websites: "base",
      name,
      weight: value(row, "weight"),
      product_online: "1",
      visibility: "Catalog, Search",
      price: value(row, "price"),
      special_price: value(row, "special_price"),
      ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, value(row, field)])),
    };
    if (pictures.length > 0) {
      // Commas separate additional images, so they can't appear inside a URL.
      const [first, ...rest] = pictures.map((url) => url.replace(/,/g, "%2C"));
      Object.assign(cells, {
        base_image: first,
        base_image_label: label,
        small_image: first,
        small_image_label: label,
        thumbnail_image: first,
        thumbnail_image_label: label,
        additional_images: rest.join(","),
      });
    }
    if (mapped("qty")) {
      const qty = value(row, "qty");
      cells.qty = qty;
      cells.is_in_stock = qty && Number(qty) > 0 ? "1" : "0";
    }
    return Object.assign(cells, extra);
  };
  const picturesOf = (rows: Row[]) =>
    mapped("images")
      ? [...new Set(rows.flatMap((row) => images(row, mapping.images)))].filter(isImportableImage)
      : [];
  const skuFor = (row: Row, fallback: string) => uniqueSku((value(row, "sku") || slugify(fallback)).slice(0, SKU_MAX));
  const urlKeyFor = (row: Row, fallback: string) => uniqueUrlKey(slugify(value(row, "url_key")) || slugify(fallback));

  for (const [productIndex, members] of products.entries()) {
    const primary = members[0];
    if (!primary) continue;
    const name = value(primary, "name") || `Product ${productIndex + 1}`;

    // Without a variant attribute, each row is its own simple product.
    if (members.length === 1 || !attributeCode) {
      for (const [index, row] of members.entries()) {
        const rowName = value(row, "name") || name;
        const fallback = members.length > 1 ? `${rowName}-${index + 1}` : rowName;
        csv.push(
          productRow(row, { sku: skuFor(row, fallback), url_key: urlKeyFor(row, fallback) }, picturesOf([row]), rowName)
        );
      }
      await onProduct?.();
      continue;
    }

    const variations: string[] = [];
    for (const [index, row] of members.entries()) {
      const option = attributeValue(value(row, "configurable_option")) || `Option ${index + 1}`;
      const childName = `${name} - ${option}`;
      const sku = skuFor(row, childName);
      variations.push(`sku=${sku},${attributeCode}=${option}`);
      csv.push(
        productRow(
          row,
          {
            sku,
            name: childName,
            visibility: "Not Visible Individually",
            url_key: uniqueUrlKey(slugify(childName)),
            additional_attributes: `${attributeCode}=${option}`,
          },
          picturesOf([row]).slice(0, 1),
          childName
        )
      );
    }
    // The configurable parent comes after its children, which it lists by SKU.
    const parentSku = uniqueSku(`${slugify(name).slice(0, SKU_MAX - 7)}-parent`);
    csv.push(
      productRow(
        primary,
        {
          sku: parentSku,
          product_type: "configurable",
          url_key: urlKeyFor(primary, name),
          qty: "",
          is_in_stock: mapped("qty") ? "1" : "",
          configurable_variations: variations.join("|"),
          configurable_variation_labels: `${attributeCode}=${attributeValue(input.optionName || attributeCode)}`,
        },
        picturesOf(members),
        name
      )
    );
    await onProduct?.();
  }
  return csv.toString();
}
