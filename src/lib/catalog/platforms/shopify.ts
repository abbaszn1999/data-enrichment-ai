import type {
  ExportPlatformField,
  ExportPlatformOption,
  MappableColumn,
  PlatformMapping,
} from "@/lib/catalog/platforms/types";

/**
 * Shopify product CSV (Products → Import). One product spans several lines
 * sharing a Handle: the first carries the product fields, each variant adds a
 * line, and every extra picture adds a line with only Handle + Image Src.
 * Shopify downloads each Image Src during the import, so links only need to
 * stay valid until then.
 */

export const SHOPIFY_FIELDS: (ExportPlatformField & { aliases: string[] })[] = [
  {
    id: "Handle",
    label: "Handle",
    hint: "Matches existing products. Left empty, it is made from the title.",
    aliases: ["handle", "url key", "slug"],
  },
  {
    id: "Title",
    label: "Title",
    required: true,
    aliases: ["title", "name", "product name", "product title", "اسم المنتج", "الاسم"],
  },
  {
    id: "Body (HTML)",
    label: "Description",
    aliases: ["body html", "body", "description", "long description", "product description", "الوصف"],
  },
  { id: "Vendor", label: "Vendor", aliases: ["vendor", "brand", "manufacturer", "الماركة", "العلامة التجارية"] },
  { id: "Type", label: "Product type", aliases: ["type", "product type", "category", "الفئة", "التصنيف"] },
  { id: "Tags", label: "Tags", aliases: ["tags", "keywords"] },
  {
    id: "Option1 Value",
    label: "Variant option",
    hint: "e.g. Size or Color. The column name becomes the option name.",
    aliases: ["option1 value", "size", "color", "colour", "variant", "المقاس", "اللون"],
  },
  { id: "Variant SKU", label: "SKU", aliases: ["variant sku", "sku", "item code", "رمز المنتج"] },
  { id: "Variant Price", label: "Price", aliases: ["variant price", "price", "sale price", "السعر"] },
  {
    id: "Variant Compare At Price",
    label: "Compare-at price",
    aliases: ["variant compare at price", "compare at price", "regular price", "msrp", "rrp"],
  },
  { id: "Variant Barcode", label: "Barcode", aliases: ["variant barcode", "barcode", "ean", "upc", "gtin"] },
  { id: "Variant Grams", label: "Weight (grams)", aliases: ["variant grams", "grams", "weight"] },
  {
    id: "Variant Inventory Qty",
    label: "Inventory",
    aliases: ["variant inventory qty", "inventory", "stock", "qty", "quantity"],
  },
  {
    id: "Image Src",
    label: "Images",
    hint: "Every link in the cell becomes a product picture.",
    aliases: ["image src", "image urls", "images", "image", "image url", "picture", "pictures", "photo", "photos"],
  },
  { id: "Image Alt Text", label: "Image alt text", aliases: ["image alt text", "alt text", "alt"] },
  { id: "SEO Title", label: "SEO title", aliases: ["seo title", "meta title"] },
  { id: "SEO Description", label: "SEO description", aliases: ["seo description", "meta description"] },
];

/** "seoTitle" / "Meta_Description (AI)" → "seo title" / "meta description". */
function normalizeName(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\(ai\)/gi, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Column keys look like "original:Name" or "enriched:seoTitle". */
function columnNames(column: MappableColumn): string[] {
  const id = column.key.slice(column.key.indexOf(":") + 1);
  return [normalizeName(column.label), normalizeName(id)];
}

export function guessShopifyMapping(columns: MappableColumn[]): PlatformMapping {
  const mapping: PlatformMapping = {};
  const used = new Set<string>();
  // AI columns are the improved version of a sheet column with the same name.
  const ordered = [
    ...columns.filter((c) => c.key.startsWith("enriched:")),
    ...columns.filter((c) => !c.key.startsWith("enriched:")),
  ];
  for (const field of SHOPIFY_FIELDS) {
    for (const alias of field.aliases) {
      const match = ordered.find((c) => !used.has(c.key) && columnNames(c).includes(alias));
      if (match) {
        mapping[field.id] = match.key;
        used.add(match.key);
        break;
      }
    }
  }
  return mapping;
}

export const SHOPIFY_PLATFORM: ExportPlatformOption = {
  id: "shopify",
  title: "Shopify",
  description: "Product CSV for Shopify admin → Products → Import",
  fields: SHOPIFY_FIELDS.map(({ aliases: _aliases, ...field }) => field),
  guessMapping: guessShopifyMapping,
  note:
    "Image links stay valid for 7 days. Import the file in Shopify before then; Shopify keeps its own copy of each picture.",
};

export function shopifyHandle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/** Plain text gets paragraphs; text that already holds HTML is kept. */
export function toShopifyHtml(value: string): string {
  const text = value.trim();
  if (!text || /<[a-z][\s\S]*>/i.test(text)) return text;
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${paragraph.trim().replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** "$1,299.00" / "1.299,00 €" → "1299.00". */
export function toShopifyNumber(value: string): string {
  let text = value.replace(/[^\d.,-]/g, "");
  if (!text) return "";
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Comma is the decimal mark only when 1–2 digits follow it.
    text = /,\d{1,2}$/.test(text)
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else {
    text = text.replace(/,/g, "");
  }
  return text;
}

const NUMBER_FIELDS = new Set(["Variant Price", "Variant Compare At Price", "Variant Grams", "Variant Inventory Qty"]);
const PRODUCT_FIELDS = ["Title", "Body (HTML)", "Vendor", "Type", "Tags", "SEO Title", "SEO Description"];
const VARIANT_FIELDS = [
  "Variant SKU",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Barcode",
  "Variant Grams",
  "Variant Inventory Qty",
];

export type ShopifyCsvInput<Row> = {
  /** One entry per product; each holds its variant rows, primary first. */
  products: Row[][];
  /** Field id → column key, from the mapping step. */
  mapping: PlatformMapping;
  /** Label of the column mapped to Option1 Value (becomes Option1 Name). */
  optionName?: string;
  text: (row: Row, columnKey: string) => string;
  images: (row: Row, columnKey: string) => string[];
  /** Called once per product; may yield or throw to cancel. */
  onProduct?: () => Promise<void>;
};

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function buildShopifyCsv<Row>(input: ShopifyCsvInput<Row>): Promise<string> {
  const { products, mapping, text, images, onProduct } = input;
  const mapped = (field: string) => Boolean(mapping[field]);
  const value = (row: Row, field: string): string => {
    const key = mapping[field];
    if (!key) return "";
    const raw = text(row, key).trim();
    if (field === "Body (HTML)") return toShopifyHtml(raw);
    if (field === "Tags") return raw.split(/\s*[\n,]\s*/).filter(Boolean).join(", ");
    if (NUMBER_FIELDS.has(field)) return toShopifyNumber(raw);
    return raw.replace(/\s*\n\s*/g, " ");
  };

  // Only mapped fields get a column: on "overwrite existing products",
  // Shopify blanks any included column left empty.
  const headers = [
    "Handle",
    ...PRODUCT_FIELDS.filter(mapped),
    "Option1 Name",
    "Option1 Value",
    ...VARIANT_FIELDS.filter(mapped),
    ...(mapped("Image Src") ? ["Image Src", "Image Position", "Image Alt Text"] : []),
  ];
  const lines = [headers.map(csvCell).join(",")];
  const push = (cells: Record<string, string>) =>
    lines.push(headers.map((header) => csvCell(cells[header] ?? "")).join(","));

  const usedHandles = new Map<string, number>();
  for (const [productIndex, members] of products.entries()) {
    const primary = members[0];
    if (!primary) continue;
    const base =
      shopifyHandle(value(primary, "Handle")) ||
      shopifyHandle(value(primary, "Title")) ||
      `product-${productIndex + 1}`;
    const seen = usedHandles.get(base) ?? 0;
    usedHandles.set(base, seen + 1);
    const handle = seen === 0 ? base : `${base}-${seen + 1}`;

    const hasOption = mapped("Option1 Value");
    const optionName = hasOption ? input.optionName || "Option" : members.length > 1 ? "Variant" : "Title";

    const pictures = mapped("Image Src")
      ? [...new Set(members.flatMap((row) => images(row, mapping["Image Src"])))]
      : [];
    const altText = value(primary, "Image Alt Text") || value(primary, "Title");

    for (const [variantIndex, row] of members.entries()) {
      const cells: Record<string, string> = { Handle: handle };
      if (variantIndex === 0) {
        for (const field of PRODUCT_FIELDS) cells[field] = value(row, field);
        cells["Option1 Name"] = optionName;
      }
      cells["Option1 Value"] = hasOption
        ? value(row, "Option1 Value") || `Option ${variantIndex + 1}`
        : members.length > 1
          ? value(row, "Variant SKU") || `Variant ${variantIndex + 1}`
          : "Default Title";
      for (const field of VARIANT_FIELDS) cells[field] = value(row, field);
      const picture = pictures[variantIndex];
      if (picture) {
        cells["Image Src"] = picture;
        cells["Image Position"] = String(variantIndex + 1);
        cells["Image Alt Text"] = altText;
      }
      push(cells);
    }
    for (let i = members.length; i < pictures.length; i += 1) {
      push({
        Handle: handle,
        "Image Src": pictures[i],
        "Image Position": String(i + 1),
        "Image Alt Text": altText,
      });
    }
    await onProduct?.();
  }
  return lines.join("\r\n");
}
