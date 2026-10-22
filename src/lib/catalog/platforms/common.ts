import type { ExportPlatformField, MappableColumn, PlatformMapping } from "@/lib/catalog/platforms/types";

/** A platform field plus the column names that suggest it. */
export type AliasedField = ExportPlatformField & { aliases: string[] };

/** What every platform CSV builder receives. */
export type PlatformCsvInput<Row> = {
  /** One entry per product; each holds its variant rows, primary first. */
  products: Row[][];
  /** Field id → column key, from the mapping step. */
  mapping: PlatformMapping;
  /** Label of the column mapped to the variant option (becomes its name). */
  optionName?: string;
  text: (row: Row, columnKey: string) => string;
  images: (row: Row, columnKey: string) => string[];
  /** Called once per product; may yield or throw to cancel. */
  onProduct?: () => Promise<void>;
};

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

export function guessMapping(fields: AliasedField[], columns: MappableColumn[]): PlatformMapping {
  const mapping: PlatformMapping = {};
  const used = new Set<string>();
  // AI columns are the improved version of a sheet column with the same name.
  const ordered = [
    ...columns.filter((c) => c.key.startsWith("enriched:")),
    ...columns.filter((c) => !c.key.startsWith("enriched:")),
  ];
  for (const field of fields) {
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

export function withoutAliases(fields: AliasedField[]): ExportPlatformField[] {
  return fields.map(({ id, label, required, hint }) => ({ id, label, required, hint }));
}

/** URL-safe slug: "Men's Shoes!" → "men-s-shoes". Keeps non-Latin letters. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/** Plain text gets paragraphs; text that already holds HTML is kept. */
export function toHtml(value: string): string {
  const text = value.trim();
  if (!text || /<[a-z][\s\S]*>/i.test(text)) return text;
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${paragraph.trim().replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** "$1,299.00" / "1.299,00 €" → "1299.00". Stores take no currency symbols. */
export function toPlainNumber(value: string): string {
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

export function toWholeNumber(value: string): string {
  const number = Number.parseFloat(toPlainNumber(value));
  return Number.isFinite(number) ? String(Math.round(number)) : "";
}

/** Cuts at the last word boundary that fits, so limits never split a word. */
export function fitLength(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.5 ? cut.slice(0, space) : cut).trim();
}

/** Stores download images only from public https links. */
export function isImportableImage(url: string): boolean {
  return /^https:\/\//i.test(url);
}

export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A multi-line or comma list cell → its items. */
export function listItems(value: string): string[] {
  return value.split(/\s*[\n,|]\s*/).map((item) => item.trim()).filter(Boolean);
}

/** Collects lines for a header set; cells missing from a line stay empty. */
export function csvWriter(headers: string[]) {
  const lines = [headers.map(csvCell).join(",")];
  return {
    push: (cells: Record<string, string>) =>
      lines.push(headers.map((header) => csvCell(cells[header] ?? "")).join(",")),
    // UTF-8 with LF line endings, as Shopify, WooCommerce and Magento expect.
    toString: () => lines.join("\n"),
  };
}

/** Hands out unique values, adding -2, -3… on repeats. */
export function uniqueNamer() {
  const used = new Map<string, number>();
  return (base: string) => {
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };
}
