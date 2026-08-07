/**
 * Resolve which sheet rows sync_images_search should touch.
 * Prevents accidentally blasting the whole catalog when the user named one product.
 */

import type { SyncSheetRow } from "@/lib/sync/core/types";

const REQUEST_NOISE =
  /\b(image|images|photo|picture|packshot|featured|add|put|find|search|fetch|get|please|for|this|product|products)\b/gi;

const ARABIC_NOISE =
  /أريد|اريد|أن|ان|تضع|ضع|صورة|صور|لي|هذا|هذه|المنتج|منتج|المنتجات|جلب|ابحث|بحث|عن|على|الى|إلى|من|في/g;

export function normalizeForMatch(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(ARABIC_NOISE, " ")
    .replace(REQUEST_NOISE, " ")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when instruction looks like a full user chat request rather than a
 * short image-search hint ("white background", "packshot").
 */
export function isLikelyUserChatInstruction(instruction: string): boolean {
  const t = String(instruction ?? "").trim();
  if (t.length > 80) return true;
  if (/أريد|اريد|تضع|صورة لي|هذا المنتج/i.test(t)) return true;
  if (/\bi want\b|\bplease\b|\badd (an )?image\b/i.test(t)) return true;
  return false;
}

/** True when the user explicitly asked to image the whole catalog. */
export function isCatalogWideImageIntent(instruction: string): boolean {
  const t = String(instruction ?? "");
  if (
    /\b(all products|every product|entire catalog|whole catalog|each product|all rows|every row)\b/i.test(
      t
    )
  ) {
    return true;
  }
  return /كل المنتجات|لجميع المنتجات|لكل منتج|لكل المنتجات|جميع المنتجات|لكل الصفوف/.test(
    t
  );
}

/**
 * Find sheet rows whose title/handle appear in the instruction (or vice versa).
 * Prefers longer title matches to avoid tiny false positives.
 */
export function matchRowIndexesByProductName(
  rows: SyncSheetRow[],
  instruction: string
): number[] {
  const hay = normalizeForMatch(instruction);
  if (!hay || hay.length < 3) return [];

  const scored: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < rows.length; i++) {
    const title = String(rows[i]?.title ?? "").trim();
    const handle = String(rows[i]?.handle ?? "").trim().replace(/-/g, " ");
    const candidates = [title, handle].filter((c) => c.length >= 3);

    let best = 0;
    for (const raw of candidates) {
      const needle = normalizeForMatch(raw);
      if (needle.length < 3) continue;
      if (hay.includes(needle) || needle.includes(hay)) {
        best = Math.max(best, needle.length);
        continue;
      }
      // Token overlap for near matches (e.g. extra punctuation)
      const hayTokens = new Set(hay.split(" ").filter((t) => t.length > 2));
      const needleTokens = needle.split(" ").filter((t) => t.length > 2);
      if (needleTokens.length === 0) continue;
      const hit = needleTokens.filter((t) => hayTokens.has(t)).length;
      if (hit === needleTokens.length && hit >= 2) {
        best = Math.max(best, needle.length);
      }
    }
    if (best > 0) scored.push({ index: i, score: best });
  }

  if (scored.length === 0) return [];

  // Keep only the strongest score group (exact named product wins over weak overlaps)
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0].score;
  return scored.filter((s) => s.score >= top * 0.85).map((s) => s.index);
}

export type ImageTargetResolution =
  | { ok: true; indexes: number[]; reason: string }
  | { ok: false; message: string };

function validIndexes(indexes: number[] | undefined, rowsLen: number): number[] {
  if (!Array.isArray(indexes) || indexes.length === 0) return [];
  return [
    ...new Set(
      indexes.filter((i) => Number.isInteger(i) && i >= 0 && i < rowsLen)
    ),
  ].sort((a, b) => a - b);
}

function isFullSheet(indexes: number[], rowsLen: number): boolean {
  return rowsLen > 1 && indexes.length >= rowsLen;
}

/**
 * Resolve image-search targets safely.
 *
 * Priority:
 * 1. Product name(s) found in the instruction (named product request)
 * 2. Explicit rowIndexes — full-sheet only if catalog-wide intent
 * 3. Remembered targets only when they are a proper subset (anaphora),
 *    or full-sheet when the user explicitly asked for all products
 * 4. Newly created rows
 * 5. Otherwise refuse — never silently search the whole catalog
 */
export function resolveImageSearchTargets(params: {
  rows: SyncSheetRow[];
  instruction: string;
  explicitRowIndexes?: number[];
  lastTargetedRowIndexes?: number[];
  lastCreatedRowIndexes?: number[];
}): ImageTargetResolution {
  const rowsLen = params.rows.length;
  if (rowsLen === 0) {
    return { ok: false, message: "No products in the sheet to search images for." };
  }

  const matched = matchRowIndexesByProductName(params.rows, params.instruction);
  const explicit = validIndexes(params.explicitRowIndexes, rowsLen);
  const remembered = validIndexes(params.lastTargetedRowIndexes, rowsLen);
  const created = validIndexes(params.lastCreatedRowIndexes, rowsLen);
  const wantsAll = isCatalogWideImageIntent(params.instruction);

  // Named product(s) always win over "remembered whole sheet" — this is the
  // SonicBuds-class bug: load all → omit rowIndexes → blast the catalog.
  if (matched.length > 0 && matched.length <= 10) {
    console.log("[Sync Images] target by product name in instruction", {
      matched,
      titles: matched.map((i) => String(params.rows[i]?.title ?? "")),
    });
    return {
      ok: true,
      indexes: matched,
      reason: "instruction_product_name",
    };
  }

  if (explicit.length > 0) {
    if (isFullSheet(explicit, rowsLen) && !wantsAll) {
      return {
        ok: false,
        message:
          "Image search refused to run on the entire catalog. Name the product(s), pass specific rowIndexes, or clearly ask for images for all products.",
      };
    }
    return {
      ok: true,
      indexes: explicit,
      reason: isFullSheet(explicit, rowsLen)
        ? "explicit_full_sheet_catalog_intent"
        : "explicit_row_indexes",
    };
  }

  if (remembered.length > 0 && !isFullSheet(remembered, rowsLen)) {
    return { ok: true, indexes: remembered, reason: "remembered_subset" };
  }

  if (created.length > 0) {
    return { ok: true, indexes: created, reason: "created_rows" };
  }

  if (remembered.length > 0 && isFullSheet(remembered, rowsLen)) {
    if (wantsAll) {
      return {
        ok: true,
        indexes: remembered,
        reason: "remembered_full_sheet_catalog_intent",
      };
    }
    return {
      ok: false,
      message:
        "Image search refused: the last load targeted the whole sheet, but the request did not name a specific product. Ask which product needs an image, or pass rowIndexes for that product only.",
    };
  }

  // Single-row sheet: safe to use that one row
  if (rowsLen === 1) {
    return { ok: true, indexes: [0], reason: "single_row_sheet" };
  }

  if (wantsAll) {
    return {
      ok: true,
      indexes: Array.from({ length: rowsLen }, (_, i) => i),
      reason: "catalog_wide_intent",
    };
  }

  return {
    ok: false,
    message:
      "Could not determine which product needs an image. Pass rowIndexes for the target product, or include the exact product title in the request.",
  };
}

/** Build a clean web-image query from product fields (not the raw user chat). */
export function buildProductImageQuery(row: SyncSheetRow): string {
  return [row.title, row.vendor, row.product_type, row.tags]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
