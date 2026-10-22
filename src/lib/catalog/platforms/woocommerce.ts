import {
  csvWriter,
  fitLength,
  guessMapping,
  isImportableImage,
  listItems,
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
 * WooCommerce product CSV (Products → Import), headers as in the built-in
 * importer's schema and sample_products.csv. A product with one row is
 * `simple`; a product with several rows becomes a `variable` parent followed
 * by one `variation` row each, linked through Parent = the parent's SKU.
 * WooCommerce downloads every Images URL during the import.
 */

export const WOOCOMMERCE_FIELDS: AliasedField[] = [
  {
    id: "SKU",
    label: "SKU",
    hint: "Matches existing products when \"Update existing products\" is ticked.",
    aliases: ["sku", "variant sku", "item code", "رمز المنتج"],
  },
  {
    id: "Name",
    label: "Name",
    required: true,
    aliases: ["name", "title", "product name", "product title", "اسم المنتج", "الاسم"],
  },
  {
    id: "Description",
    label: "Description",
    aliases: ["description", "body html", "body", "long description", "product description", "الوصف"],
  },
  {
    id: "Short description",
    label: "Short description",
    aliases: ["short description", "summary", "excerpt", "الوصف المختصر"],
  },
  { id: "Regular price", label: "Regular price", aliases: ["regular price", "price", "السعر"] },
  { id: "Sale price", label: "Sale price", aliases: ["sale price", "special price", "discount price"] },
  {
    id: "Categories",
    label: "Categories",
    hint: "Use > for sub-categories, e.g. Clothing > Shirts.",
    aliases: ["categories", "category", "product category", "الفئة", "التصنيف"],
  },
  { id: "Tags", label: "Tags", aliases: ["tags", "keywords"] },
  {
    id: "Attribute 1 value(s)",
    label: "Variant option",
    hint: "e.g. Size or Color. The column name becomes the attribute name.",
    aliases: ["attribute 1 value s", "size", "color", "colour", "variant", "المقاس", "اللون"],
  },
  {
    id: "Stock",
    label: "Stock",
    hint: "A number turns on stock management.",
    aliases: ["stock", "inventory", "qty", "quantity", "inventory quantity"],
  },
  {
    id: "Weight",
    label: "Weight",
    hint: "In your store's weight unit (WooCommerce → Settings → Products).",
    aliases: ["weight"],
  },
  {
    id: "Images",
    label: "Images",
    hint: "Every https link in the cell; the first becomes the featured image.",
    aliases: ["images", "image urls", "image src", "image", "image url", "picture", "pictures", "photo", "photos"],
  },
  {
    id: "Meta: _yoast_wpseo_title",
    label: "SEO title (Yoast)",
    hint: "Read by the Yoast SEO plugin.",
    aliases: ["seo title", "meta title"],
  },
  {
    id: "Meta: _yoast_wpseo_metadesc",
    label: "SEO description (Yoast)",
    hint: "Read by the Yoast SEO plugin.",
    aliases: ["seo description", "meta description"],
  },
];

export const WOOCOMMERCE_PLATFORM: ExportPlatformOption = {
  id: "woocommerce",
  title: "WooCommerce (WordPress)",
  description: "Product CSV for WooCommerce → Products → Import",
  fields: withoutAliases(WOOCOMMERCE_FIELDS),
  guessMapping: (columns) => guessMapping(WOOCOMMERCE_FIELDS, columns),
  note:
    "Image links stay valid for 7 days: import the file before then, without re-saving it in Excel. To update products already in your store, map SKU and tick \"Update existing products\".",
};

/** Header WooCommerce's importer recognises for weight in any store unit. */
const WEIGHT_HEADER = "Weight (kg)";
const PRODUCT_FIELDS = [
  "Description",
  "Short description",
  "Categories",
  "Tags",
  "Meta: _yoast_wpseo_title",
  "Meta: _yoast_wpseo_metadesc",
];
const VARIANT_FIELDS = ["Regular price", "Sale price", "Stock"];

/** Commas inside one value are escaped so WooCommerce keeps it whole. */
function escapeListValue(value: string): string {
  return value.replace(/,/g, "\\,");
}

export async function buildWooCommerceCsv<Row>(input: PlatformCsvInput<Row>): Promise<string> {
  const { products, mapping, text, images, onProduct } = input;
  const mapped = (field: string) => Boolean(mapping[field]);
  const value = (row: Row, field: string): string => {
    const key = mapping[field];
    if (!key) return "";
    const raw = text(row, key).trim();
    if (field === "Description" || field === "Short description") return toHtml(raw);
    if (field === "Tags" || field === "Categories") return listItems(raw).join(", ");
    if (field === "Regular price" || field === "Sale price" || field === "Weight") return toPlainNumber(raw);
    if (field === "Stock") return toWholeNumber(raw);
    const flat = raw.replace(/\s*\n\s*/g, " ");
    if (field === "Meta: _yoast_wpseo_title") return fitLength(flat, 70);
    if (field === "Meta: _yoast_wpseo_metadesc") return fitLength(flat, 160);
    return flat;
  };
  const picturesOf = (rows: Row[]) =>
    mapped("Images")
      ? [...new Set(rows.flatMap((row) => images(row, mapping.Images)))].filter(isImportableImage)
      : [];

  const hasVariants = products.some((members) => members.length > 1);
  const headers = [
    "Type",
    "SKU",
    "Name",
    "Published",
    ...PRODUCT_FIELDS.filter((field) => field.startsWith("Meta:") === false && mapped(field)),
    ...VARIANT_FIELDS.filter(mapped),
    ...(mapped("Weight") ? [WEIGHT_HEADER] : []),
    ...(mapped("Images") ? ["Images"] : []),
    ...(hasVariants ? ["Parent", "Attribute 1 name", "Attribute 1 value(s)", "Attribute 1 visible", "Attribute 1 global"] : []),
    ...PRODUCT_FIELDS.filter((field) => field.startsWith("Meta:") && mapped(field)),
  ];
  const csv = csvWriter(headers);
  const uniqueSku = uniqueNamer();

  for (const [productIndex, members] of products.entries()) {
    const primary = members[0];
    if (!primary) continue;
    const name = value(primary, "Name");
    const productCells: Record<string, string> = { Name: name, Published: "1" };
    for (const field of PRODUCT_FIELDS) productCells[field] = value(primary, field);

    if (members.length === 1) {
      csv.push({
        ...productCells,
        Type: "simple",
        SKU: value(primary, "SKU"),
        ...Object.fromEntries(VARIANT_FIELDS.map((field) => [field, value(primary, field)])),
        [WEIGHT_HEADER]: value(primary, "Weight"),
        Images: picturesOf(members).join(", "),
      });
      await onProduct?.();
      continue;
    }

    // Variable product: the parent holds every option value and all pictures,
    // each variation its own price, stock, SKU and first picture.
    const attributeName = mapped("Attribute 1 value(s)") ? input.optionName || "Option" : "Variant";
    const optionValues = members.map(
      (row, index) =>
        (mapped("Attribute 1 value(s)") ? value(row, "Attribute 1 value(s)") : value(row, "SKU")) ||
        `${attributeName} ${index + 1}`
    );
    // The parent needs its own SKU for variations to point at; theirs stay as is.
    const parentSku = uniqueSku(slugify(name) || `product-${productIndex + 1}`);
    csv.push({
      ...productCells,
      Type: "variable",
      SKU: parentSku,
      Images: picturesOf(members).join(", "),
      "Attribute 1 name": attributeName,
      "Attribute 1 value(s)": [...new Set(optionValues)].map(escapeListValue).join(", "),
      "Attribute 1 visible": "1",
      "Attribute 1 global": "0",
    });
    for (const [index, row] of members.entries()) {
      csv.push({
        Type: "variation",
        SKU: value(row, "SKU"),
        Name: `${name} - ${optionValues[index]}`,
        Published: "1",
        Parent: parentSku,
        ...Object.fromEntries(VARIANT_FIELDS.map((field) => [field, value(row, field)])),
        [WEIGHT_HEADER]: value(row, "Weight"),
        Images: picturesOf([row])[0] ?? "",
        "Attribute 1 name": attributeName,
        "Attribute 1 value(s)": escapeListValue(optionValues[index]),
        "Attribute 1 visible": "1",
        "Attribute 1 global": "0",
      });
    }
    await onProduct?.();
  }
  // BOM, like WooCommerce's own sample file, so Excel opens it as UTF-8 too.
  return "\uFEFF" + csv.toString();
}
