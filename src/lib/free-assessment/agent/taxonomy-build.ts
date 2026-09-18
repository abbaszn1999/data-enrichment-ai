// ─── Searchable Category Taxonomy — pure build/dedup logic ────────────────
//
// Everything here is deterministic and model-free: candidate preparation,
// language detection, WooCommerce hierarchy folding, coverage verification,
// and SKU-total math. Gemini only ever sees the output of `buildTaxonomyCandidates`
// and only ever decides labels/placement — never a count. See
// `taxonomy-types.ts` for the shapes and `stage1-niche-discovery.ts` for the
// two-pass orchestration that calls these functions around the model calls.

import type {
  ExcludedItem,
  ExclusionReason,
  TaxonomyAssignment,
  TaxonomyCandidate,
  TaxonomyCategory,
  TaxonomySubcategory,
} from "./taxonomy-types";

// ─── Candidate input ────────────────────────────────────────────────────

/** Structurally compatible with `StoreCollectionItem` — callers can pass
 *  that type directly without a conversion step. */
export type RawCandidateInput = {
  id: string;
  name: string;
  productCount: number;
  description?: string;
  plpPath?: string;
  parentId?: string;
  depth?: number;
  kind?: "collection" | "brand";
};

// ─── Language detection ─────────────────────────────────────────────────

const SCRIPT_RANGES: Array<{ code: string; pattern: RegExp }> = [
  { code: "ar", pattern: /[\u0600-\u06FF\u0750-\u077F]/ },
  { code: "he", pattern: /[\u0590-\u05FF]/ },
  { code: "ru", pattern: /[\u0400-\u04FF]/ },
  { code: "zh", pattern: /[\u4E00-\u9FFF]/ },
  { code: "ja", pattern: /[\u3040-\u30FF]/ },
  { code: "ko", pattern: /[\uAC00-\uD7AF]/ },
  { code: "th", pattern: /[\u0E00-\u0E7F]/ },
  { code: "el", pattern: /[\u0370-\u03FF]/ },
];

const MARKET_LANGUAGE_HINTS: Array<{ code: string; keywords: string[] }> = [
  { code: "ar", keywords: ["arab", "saudi", "uae", "emirates", "egypt", "gulf", "qatar", "kuwait"] },
  { code: "es", keywords: ["spain", "mexico", "latam", "argentina", "colombia"] },
  { code: "fr", keywords: ["france", "quebec"] },
  { code: "de", keywords: ["germany", "austria"] },
  { code: "pt", keywords: ["brazil", "portugal"] },
];

/**
 * Detects the language every taxonomy label must be written in, from the
 * store's own PLP/brand names — never assumed purely from the store's
 * configured market, since a US-registered storefront can still sell to an
 * entirely Arabic-, Spanish-, or French-speaking audience in that language.
 * Requires a real signal (multiple non-Latin names) before overriding the
 * default Latin/English assumption, so one mistyped or borrowed word in a
 * mostly-English catalog can't flip the whole tree's language.
 */
export function detectOutputLanguage(
  candidates: Array<{ name: string }>,
  marketHint?: string
): string {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const name = candidate.name || "";
    for (const { code, pattern } of SCRIPT_RANGES) {
      if (pattern.test(name)) {
        counts.set(code, (counts.get(code) || 0) + 1);
      }
    }
  }

  let bestCode: string | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      bestCode = code;
      bestCount = count;
    }
  }

  const requiredSignal = Math.max(2, Math.ceil(candidates.length * 0.15));
  if (bestCode && bestCount >= requiredSignal) {
    return bestCode;
  }

  if (marketHint) {
    const normalized = marketHint.toLowerCase();
    for (const { code, keywords } of MARKET_LANGUAGE_HINTS) {
      if (keywords.some((kw) => normalized.includes(kw))) return code;
    }
  }

  return "en";
}

// ─── WooCommerce hierarchy resolution ───────────────────────────────────

function resolveAncestorChain(
  id: string,
  byId: Map<string, RawCandidateInput>,
  guard = 0
): string[] {
  if (guard > 25) return [id];
  const item = byId.get(id);
  if (!item || !item.parentId || item.parentId === "0" || !byId.has(item.parentId)) {
    return [id];
  }
  return [...resolveAncestorChain(item.parentId, byId, guard + 1), id];
}

/**
 * Breadcrumb of names from the top-level WooCommerce ancestor down to this
 * item. Shopify collections and every brand PLP get a single-entry path —
 * their own name — since neither has a real hierarchy to walk.
 */
export function buildTaxonomyPath(
  item: RawCandidateInput,
  byId: Map<string, RawCandidateInput>
): string[] {
  if (item.kind === "brand" || !item.parentId || item.parentId === "0") {
    return [item.name];
  }
  const chain = resolveAncestorChain(item.id, byId);
  return chain.map((id) => byId.get(id)?.name || id);
}

/**
 * The natural search-granularity ceiling: WooCommerce items at depth 0 or 1
 * are exactly what the two-level category/subcategory output has room for.
 * Anything deeper (depth >= 2, e.g. Toys > Board Games > Strategy Games) is
 * an attribute-level split the schema can't represent as its own node — it
 * silently inherits its nearest depth-0/1 ancestor's final placement
 * instead of ever reaching the model. This is also the real scale saving
 * for deep catalogs: a store with thousands of leaf sub-sub-categories
 * never makes Pass B any bigger, since only the depth-0/1 layer is batched.
 */
export function foldDeepWooDescendants(items: RawCandidateInput[]): {
  kept: RawCandidateInput[];
  foldedInto: Map<string, string>;
} {
  const byId = new Map(items.map((i) => [i.id, i]));
  const foldedInto = new Map<string, string>();
  const kept: RawCandidateInput[] = [];

  for (const item of items) {
    const depth = item.depth ?? 0;
    if (item.kind === "brand" || depth <= 1) {
      kept.push(item);
      continue;
    }
    const chain = resolveAncestorChain(item.id, byId); // ascending: [...ancestors, item.id]
    let ancestorId = chain[0];
    for (let i = chain.length - 2; i >= 0; i--) {
      const ancestor = byId.get(chain[i]);
      if (ancestor && (ancestor.depth ?? 0) <= 1) {
        ancestorId = chain[i];
        break;
      }
    }
    foldedInto.set(item.id, ancestorId);
  }

  return { kept, foldedInto };
}

// ─── Candidate preparation ──────────────────────────────────────────────

export function buildTaxonomyCandidates(items: RawCandidateInput[]): {
  candidates: TaxonomyCandidate[];
  foldedInto: Map<string, string>;
  foldedItems: RawCandidateInput[];
} {
  const byId = new Map(items.map((i) => [i.id, i]));
  const { kept, foldedInto } = foldDeepWooDescendants(items);
  const foldedIds = new Set(foldedInto.keys());
  const foldedItems = items.filter((i) => foldedIds.has(i.id));

  const candidates: TaxonomyCandidate[] = kept.map((item) => ({
    id: item.id,
    name: item.name,
    productCount: item.productCount,
    description: item.description,
    plpPath: item.plpPath,
    kind: item.kind === "brand" ? "brand" : "collection",
    parentId: item.parentId && item.parentId !== "0" ? item.parentId : undefined,
    depth: item.depth ?? 0,
    taxonomyPath: buildTaxonomyPath(item, byId),
  }));

  return { candidates, foldedInto, foldedItems };
}

export function indexCandidatesById(
  candidates: TaxonomyCandidate[]
): Map<string, TaxonomyCandidate> {
  return new Map(candidates.map((c) => [c.id, c]));
}

// ─── Batching ───────────────────────────────────────────────────────────

/**
 * Pass B never sends every id in one call — batching keeps each call's
 * output small and independently verifiable, and keeps a single store's
 * size from ever pushing one call toward the token ceiling.
 */
export function batchCandidates<T>(items: T[], batchSize = 300): T[][] {
  if (items.length === 0) return [];
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

// ─── Coverage verification ──────────────────────────────────────────────

/**
 * Every candidate id must end up in `assignments` or `excluded` — anything
 * else is a gap the model left, not a legitimate omission. Callers should
 * retry `missingIds` in a follow-up batch before ever routing them to
 * `unresolved`, so nothing is dropped just because one batch call missed it.
 */
export function verifyAssignmentCoverage(
  candidateIds: string[],
  assignments: TaxonomyAssignment[],
  excluded: ExcludedItem[]
): { missingIds: string[]; coveredIds: Set<string> } {
  const covered = new Set<string>();
  for (const a of assignments) covered.add(a.itemId);
  for (const e of excluded) covered.add(e.itemId);
  const missingIds = candidateIds.filter((id) => !covered.has(id));
  return { missingIds, coveredIds: covered };
}

/** Last-resort routing after retries are exhausted — visible and zero-SKU,
 *  never silently absorbed into an unrelated category's total. */
export function routeMissingToUnresolved(
  missingIds: string[],
  candidatesById: Map<string, TaxonomyCandidate>
): ExcludedItem[] {
  return missingIds.map((id) => ({
    itemId: id,
    name: candidatesById.get(id)?.name || id,
    reason: "unresolved" as ExclusionReason,
  }));
}

// ─── Primary-assignment enforcement ──────────────────────────────────────

/**
 * Enforces "exactly one primary assignment per itemId across the whole
 * tree" regardless of what the model returned. Zero primaries (the model
 * forgot) or multiple primaries (the model didn't resolve its own overlap)
 * both deterministically collapse to the first assignment being primary,
 * rather than either double-counting or zero-counting that item. Exact
 * duplicate (itemId, subcategoryId) pairs — e.g. a retried batch call
 * coincidentally re-emitting the same placement — are collapsed to one
 * entry first, so a stray duplicate can never flip an item's only real
 * placement to non-primary by chance ordering.
 */
export function normalizeAssignments(
  assignments: TaxonomyAssignment[]
): TaxonomyAssignment[] {
  const dedupedByKey = new Map<string, TaxonomyAssignment>();
  for (const a of assignments) {
    const key = `${a.itemId}:${a.subcategoryId}`;
    const existing = dedupedByKey.get(key);
    // Keep whichever copy is primary if any of the duplicates say so.
    if (!existing || (a.primary && !existing.primary)) {
      dedupedByKey.set(key, a);
    }
  }
  const deduped = Array.from(dedupedByKey.values());

  const byItem = new Map<string, TaxonomyAssignment[]>();
  for (const a of deduped) {
    const list = byItem.get(a.itemId) || [];
    list.push(a);
    byItem.set(a.itemId, list);
  }

  const result: TaxonomyAssignment[] = [];
  for (const list of byItem.values()) {
    const primaryCount = list.filter((a) => a.primary).length;
    if (primaryCount === 1) {
      result.push(...list);
      continue;
    }
    result.push(...list.map((a, i) => ({ ...a, primary: i === 0 })));
  }
  return result;
}

/**
 * Ground-truth override for the one case code can verify without any
 * model judgment: a real WooCommerce parent and its kept child (both
 * depth <= 1, both present as candidates) landing in the very same
 * subcategory. The parent's productCount already contains the child's by
 * construction, so the child is forced non-primary here regardless of what
 * the model marked — this is not a judgment call the way sibling overlap
 * (e.g. "Laptops" vs "Apple laptops") is, so it isn't left to the skill.
 */
export function enforceWooParentPrimacy(
  assignments: TaxonomyAssignment[],
  candidatesById: Map<string, TaxonomyCandidate>
): TaxonomyAssignment[] {
  const bySubcategory = new Map<string, TaxonomyAssignment[]>();
  for (const a of assignments) {
    const list = bySubcategory.get(a.subcategoryId) || [];
    list.push(a);
    bySubcategory.set(a.subcategoryId, list);
  }

  const byKey = new Map<string, TaxonomyAssignment>();
  for (const a of assignments) byKey.set(`${a.itemId}:${a.subcategoryId}`, a);

  for (const list of bySubcategory.values()) {
    for (const a of list) {
      if (!a.primary) continue;
      const candidate = candidatesById.get(a.itemId);
      if (!candidate?.parentId) continue;
      const parentAssignment = list.find((other) => other.itemId === candidate.parentId);
      if (!parentAssignment) continue;

      byKey.set(`${a.itemId}:${a.subcategoryId}`, { ...a, primary: false });
      const parentKey = `${parentAssignment.itemId}:${parentAssignment.subcategoryId}`;
      byKey.set(parentKey, { ...byKey.get(parentKey)!, primary: true });
    }
  }

  return Array.from(byKey.values());
}

// ─── SKU totals ──────────────────────────────────────────────────────────

export type CategoryLabelInput = {
  id: string;
  name: string;
  overlapping?: boolean;
  subcategories: Array<{ id: string; name: string }>;
};

/**
 * Deterministic, model-free SKU math. Only primary assignments contribute;
 * folded deep-WooCommerce descendants roll additively into wherever their
 * kept ancestor landed (WooCommerce term counts are not recursive by
 * default, so this does not double count); categories flagged `overlapping`
 * (brand rosters) are excluded from the store-wide unique total while
 * keeping their own real counts for their own SKU-floor gating.
 */
export function computeSkuTotals(params: {
  categories: CategoryLabelInput[];
  assignments: TaxonomyAssignment[];
  candidates: TaxonomyCandidate[];
  foldedItems?: RawCandidateInput[];
  foldedInto?: Map<string, string>;
}): { categories: TaxonomyCategory[]; totalUniqueProducts: number } {
  const {
    categories: categoryLabels,
    assignments,
    candidates,
    foldedItems = [],
    foldedInto = new Map(),
  } = params;

  const candidatesById = indexCandidatesById(candidates);
  const primaryByItem = new Map<string, TaxonomyAssignment>();
  for (const a of assignments) {
    if (a.primary) primaryByItem.set(a.itemId, a);
  }

  const subcategoryTotals = new Map<string, number>();
  for (const [itemId, assignment] of primaryByItem) {
    const candidate = candidatesById.get(itemId);
    if (!candidate) continue;
    subcategoryTotals.set(
      assignment.subcategoryId,
      (subcategoryTotals.get(assignment.subcategoryId) || 0) + candidate.productCount
    );
  }

  for (const descendant of foldedItems) {
    const ancestorId = foldedInto.get(descendant.id);
    if (!ancestorId) continue;
    const ancestorAssignment = primaryByItem.get(ancestorId);
    if (!ancestorAssignment) continue; // ancestor excluded — descendant excluded too
    subcategoryTotals.set(
      ancestorAssignment.subcategoryId,
      (subcategoryTotals.get(ancestorAssignment.subcategoryId) || 0) + descendant.productCount
    );
  }

  const categories: TaxonomyCategory[] = categoryLabels.map((cat) => {
    const subcategories: TaxonomySubcategory[] = cat.subcategories.map((sub) => ({
      id: sub.id,
      name: sub.name,
      productCount: subcategoryTotals.get(sub.id) || 0,
    }));
    const productCount = subcategories.reduce((sum, s) => sum + s.productCount, 0);
    return {
      id: cat.id,
      name: cat.name,
      overlapping: cat.overlapping,
      productCount,
      subcategories,
    };
  });

  const totalUniqueProducts = categories
    .filter((c) => !c.overlapping)
    .reduce((sum, c) => sum + c.productCount, 0);

  return { categories, totalUniqueProducts };
}
