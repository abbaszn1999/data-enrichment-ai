/**
 * Shared "is this row already in the store?" pass, used by the rules, review
 * and workspace pages so all three agree on matchType.
 *
 * Product sessions match uploaded rows against master products by SKU-like
 * columns. PLP sessions match uploaded category rows against categories.json.
 */
import type { SessionKind } from "@/types";
import {
  loadCategoriesJson,
  loadProductsJson,
  type CategoryJson,
} from "@/lib/storage-helpers";
import { normalizeValue, type MatchingRule } from "@/lib/matching";

/** Trim + case-insensitive + drop a trailing slash, for matching URLs/paths. */
export const PLP_MATCHING_RULES: MatchingRule[] = [
  {
    type: "trim_whitespace",
    enabled: true,
    label: "Trim Whitespace",
    description: "Remove spaces from both sides",
  },
  {
    type: "case_insensitive",
    enabled: true,
    label: "Case Insensitive",
    description: "Compare as lowercase",
  },
  {
    type: "trim_trailing_slash",
    enabled: true,
    label: "Ignore Trailing Slash",
    description: "Treat /shoes and /shoes/ as the same page",
  },
];

/** Candidate master columns a PLP row can be matched on. */
export const PLP_MATCH_COLUMNS = ["name", "slug", "fullPath", "url"] as const;

function normalizePlp(value: string, rules: MatchingRule[]): string {
  let result = normalizeValue(value, rules);
  if (rules.some((r) => r.type === "trim_trailing_slash" && r.enabled)) {
    result = result.replace(/\/+$/, "");
  }
  return result;
}

/** Every value a stored category can legitimately be matched by. */
function categoryKeys(cat: CategoryJson, column: string): string[] {
  switch (column) {
    case "slug":
      return [cat.slug];
    case "fullPath":
      // categories.json has no fullPath; slug and name are the usable handles.
      return [cat.slug, cat.name];
    case "url":
      return [cat.slug, `/${cat.slug}`];
    default:
      return [cat.name];
  }
}

export interface MatchOutcome {
  existingCount: number;
  newCount: number;
}

export interface MatchableRow {
  originalData?: Record<string, string>;
  matchType?: unknown;
  /** Set for product sessions so callers can build a diff against the master. */
  matchedProductSku?: string;
}

/**
 * Narrow the master catalog to the categories chosen in step 2.
 * Master products carry their category as free text, so this compares names.
 */
function filterProductsByCategoryNames<T extends { data?: Record<string, unknown> }>(
  products: T[],
  categoryNames: string[]
): T[] {
  if (categoryNames.length === 0) return products;
  const needles = categoryNames
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) return products;
  return products.filter((product) => {
    const value = product.data?.CATEGORY;
    if (!value) return false;
    const haystack = String(value).toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  });
}

/**
 * Set `matchType` on each row in place and return the tallies.
 * Rows are mutated because every caller immediately persists or renders them.
 */
export async function applyMatchTypes(params: {
  kind: SessionKind;
  workspaceId: string;
  rows: MatchableRow[];
  /** Column in the uploaded file holding the identity value. */
  sourceColumn: string;
  /** Column on the master record to compare against. */
  masterColumn: string;
  rules: MatchingRule[];
  /**
   * Product sessions only: restrict the master catalog to these category names,
   * mirroring the category filter applied in step 2.
   */
  targetCategoryNames?: string[];
}): Promise<MatchOutcome> {
  const {
    kind,
    workspaceId,
    rows,
    sourceColumn,
    masterColumn,
    rules,
    targetCategoryNames = [],
  } = params;

  // normalized key -> master SKU (empty for PLP, which has no SKU).
  const masterKeys = new Map<string, string>();
  const normalize =
    kind === "plp"
      ? (v: string) => normalizePlp(v, rules)
      : (v: string) => normalizeValue(v, rules);

  if (kind === "plp") {
    const categories = await loadCategoriesJson(workspaceId);
    for (const cat of categories) {
      for (const key of categoryKeys(cat, masterColumn)) {
        const value = String(key ?? "").trim();
        if (!value) continue;
        const norm = normalize(value);
        if (norm && !masterKeys.has(norm)) masterKeys.set(norm, cat.id);
      }
    }
  } else {
    const allProducts = await loadProductsJson(workspaceId);
    const products = filterProductsByCategoryNames(
      allProducts,
      targetCategoryNames
    );
    for (const product of products) {
      const value =
        masterColumn === "sku"
          ? product.sku
          : (product.data?.[masterColumn] ?? product.sku);
      const norm = normalize(String(value ?? ""));
      if (!masterKeys.has(norm)) masterKeys.set(norm, product.sku);
    }
  }

  // "contains" is a product-side fuzzy fallback; it is far too loose for
  // category names, where it would match "Shoes" to every "...Shoes" page.
  const allowContains =
    kind !== "plp" && rules.some((r) => r.type === "contains" && r.enabled);

  let existingCount = 0;

  for (const row of rows) {
    const raw = String(row.originalData?.[sourceColumn] ?? "").trim();
    const normalized = normalize(raw);

    let matchedSku: string | undefined;
    if (normalized) {
      if (masterKeys.has(normalized)) {
        matchedSku = masterKeys.get(normalized);
      } else if (allowContains) {
        for (const [key, sku] of masterKeys) {
          if (!key) continue;
          if (normalized.includes(key) || key.includes(normalized)) {
            matchedSku = sku;
            break;
          }
        }
      }
    }

    const matched = matchedSku !== undefined;
    row.matchType = matched ? "existing" : "new";
    if (matched) {
      existingCount++;
      if (kind !== "plp") row.matchedProductSku = matchedSku;
    } else {
      delete row.matchedProductSku;
    }
  }

  return { existingCount, newCount: rows.length - existingCount };
}

/**
 * Turn stored `target_category_ids` into the category names the master catalog
 * is filtered by, so every step narrows the catalog the same way.
 */
export async function resolveTargetCategoryNames(
  workspaceId: string,
  categoryIds: string[] | null | undefined
): Promise<string[]> {
  if (!categoryIds || categoryIds.length === 0) return [];
  const categories = await loadCategoriesJson(workspaceId);
  const byId = new Map(categories.map((c) => [c.id, c.name]));
  return categoryIds
    .map((id) => byId.get(id) ?? "")
    .filter((name): name is string => name.trim() !== "");
}

/** Best-guess identity column in an uploaded categories file. */
export function guessPlpSourceColumn(columns: string[]): string {
  const lower = new Map(columns.map((c) => [c.trim().toLowerCase(), c]));
  for (const candidate of [
    "name",
    "category_name",
    "title",
    "slug",
    "handle",
    "url",
    "الاسم",
  ]) {
    const hit = lower.get(candidate);
    if (hit) return hit;
  }
  return columns[0] ?? "";
}
