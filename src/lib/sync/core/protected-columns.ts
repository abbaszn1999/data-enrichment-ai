/**
 * Columns the agent may never write, on any provider.
 *
 * Two families:
 * - Identity / inventory facts (SKU, barcode, stock) — a model can only guess,
 *   and a wrong value silently breaks warehouse sync, ERP matching and feeds.
 * - URL identity (`handle`) — changing it renames the live product URL. Ranking
 *   pages lose their indexed address; API updates do not auto-create 301s the
 *   way the admin UI does. SEO improvements belong in seo_title / seo_description.
 *
 * The human owner can still edit these cells by hand in the sheet; the block
 * applies to AI-driven writes only.
 */
export const PROTECTED_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  handle:
    "Handle is the product URL slug. Changing it breaks the indexed Google URL and any external links; API updates do not create 301 redirects. For SEO, use seo_title and seo_description instead.",
  primary_sku:
    "SKU is the join key between the store, the warehouse and product feeds. A generated value silently breaks inventory sync and ad feeds.",
  barcode:
    "Barcode (EAN/UPC/GTIN) is a globally registered number for this exact item. It cannot be inferred or improved — only copied from the supplier.",
  global_unique_id:
    "GTIN/global unique ID is a registered identifier, not editorial content. A generated value points at someone else's product.",
  inventory_total:
    "Stock quantity is a physical fact. Guessing it high oversells and cancels orders; guessing it low silently stops sales.",
  stock_status:
    "In-stock / out-of-stock reflects real warehouse state, not something that can be reasoned about from the product data.",
  manage_stock:
    "Toggling stock management changes how the platform tracks inventory for this product and can wipe or ignore existing quantities.",
});

export type ProtectedColumn = keyof typeof PROTECTED_COLUMNS;

export function isProtectedColumn(column: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROTECTED_COLUMNS, column);
}

export function protectedColumnReason(column: string): string | undefined {
  return PROTECTED_COLUMNS[column];
}

/** Provider schemas declare their full column surface; this strips the blocked ones. */
export function withoutProtectedColumns<T extends string>(
  columns: readonly T[]
): T[] {
  return columns.filter((col) => !isProtectedColumn(col));
}

/**
 * Message thrown back into the agent loop when it targets a protected column.
 * Written as an instruction to the model so the refusal reaches the user in
 * their own language instead of leaking a raw stack trace.
 */
export function protectedColumnRefusal(column: string): string {
  const reason = protectedColumnReason(column) ?? "This field is protected.";
  const seoOffer =
    column === "handle"
      ? ` If they wanted better SEO or ranking, offer to update seo_title and/or seo_description instead — never the URL.`
      : "";
  return (
    `BLOCKED: "${column}" is a protected column and can never be written by AI. ${reason} ` +
    `Tell the user plainly, in their language, that you cannot modify "${column}" — ` +
    `this is a hard safety rule, not a temporary failure, so do not retry, do not ` +
    `route around it with another tool, and do not offer to try again. Explain the ` +
    `reason above, and add that they can edit this cell manually in the sheet if the ` +
    `real value is known.${seoOffer} Then offer to help with something you are allowed to do.`
  );
}

/**
 * Removes protected keys from an AI-generated row before it enters the sheet.
 * Returns the stripped keys so the caller can surface them.
 */
export function stripProtectedColumns(
  row: Record<string, unknown>
): { row: Record<string, unknown>; stripped: string[] } {
  const stripped: string[] = [];
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isProtectedColumn(key)) {
      stripped.push(key);
      continue;
    }
    clean[key] = value;
  }
  return { row: clean, stripped };
}
