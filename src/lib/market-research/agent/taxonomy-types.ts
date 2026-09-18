// ─── Searchable Category Taxonomy — shared types ──────────────────────────
//
// Stage 1 no longer mirrors the store's own PLP/collection structure into
// "niches". It reclassifies every PLP and brand into a two-level tree of
// categories and subcategories named the way people actually search for
// them, with deduplicated SKU totals computed entirely in code. See
// `taxonomy-build.ts` for the pure logic and `stage1-niche-discovery.ts`
// for the two-pass Gemini orchestration that produces one of these trees.

export type TaxonomyItemKind = "collection" | "brand";

/**
 * One catalog item (collection/category or brand PLP) as prepared for the
 * model — after deep-WooCommerce-descendant folding, with its breadcrumb
 * path and real product count attached. This is the unit both Gemini passes
 * and `computeSkuTotals` operate on.
 */
export type TaxonomyCandidate = {
  id: string;
  name: string;
  productCount: number;
  description?: string;
  plpPath?: string;
  kind: TaxonomyItemKind;
  /** WooCommerce only. Omitted for Shopify and brand items. */
  parentId?: string;
  /** WooCommerce only. 0 = top-level, 1 = subcategory. Always 0 otherwise. */
  depth: number;
  /**
   * Breadcrumb from the top-level WooCommerce ancestor down to this item
   * (e.g. ["Women", "Clothing", "Dresses"]). A single-entry path (its own
   * name) for Shopify collections and every brand PLP, which have no real
   * hierarchy to walk.
   */
  taxonomyPath: string[];
};

export type ExclusionReason =
  | "promotional"
  | "attribute-only"
  | "duplicate"
  | "empty"
  | "unresolved";

/** A PLP/brand that is not usable for research — visible, never selectable,
 *  contributes zero SKUs. Replaces the old "dump into the largest niche"
 *  fallback so nothing is silently absorbed into an unrelated total. */
export type ExcludedItem = {
  itemId: string;
  name: string;
  reason: ExclusionReason;
};

/**
 * One item's placement under one subcategory. An item normally has exactly
 * one assignment; a brand+product PLP (e.g. "Nike Shoes") can have two —
 * primary under the product subcategory, non-primary under the brand
 * subcategory. Across the WHOLE tree, exactly one assignment per itemId
 * must be primary — only the primary one contributes to SKU totals.
 */
export type TaxonomyAssignment = {
  itemId: string;
  subcategoryId: string;
  primary: boolean;
};

export type TaxonomySubcategory = {
  id: string;
  name: string;
  /** Deduplicated product count, computed in code — never emitted by the model. */
  productCount: number;
};

export type TaxonomyCategory = {
  id: string;
  name: string;
  /**
   * True for brand-roster categories (e.g. "Women brands"). Their PLPs keep
   * real counts for their own SKU-floor gating, but the category is
   * excluded from the store-wide unique total since its inventory already
   * counts once inside a product category.
   */
  overlapping?: boolean;
  /** Deduplicated product count, computed in code. */
  productCount: number;
  subcategories: TaxonomySubcategory[];
};

export type TaxonomyTree = {
  categories: TaxonomyCategory[];
  assignments: TaxonomyAssignment[];
  excluded: ExcludedItem[];
  /** ISO-ish language code every category/subcategory label is written in
   *  (e.g. "ar", "en") — detected from the store's own PLP names. */
  outputLanguage: string;
  /** Sum of every non-overlapping category's deduplicated total. */
  totalUniqueProducts: number;
};

// ─── Gemini-facing wire schemas ────────────────────────────────────────────

/** Pass A — the model proposes the label tree only, no item ids. */
export type TaxonomyPassAOutput = {
  categories: Array<{
    id: string;
    name: string;
    overlapping?: boolean;
    subcategories: Array<{ id: string; name: string }>;
  }>;
  agentConclusion: string;
};

/** Pass B — one batch's worth of candidate ids placed onto the fixed Pass A
 *  tree, or excluded with a reason. Batched (~300 ids) so no single call's
 *  output size depends on catalog size. */
export type TaxonomyPassBOutput = {
  assignments: TaxonomyAssignment[];
  excluded: ExcludedItem[];
};
