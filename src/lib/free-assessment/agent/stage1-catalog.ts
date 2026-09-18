import type { StoreCollectionItem } from "./store-catalog";
import {
  buildTaxonomyCandidates,
  batchCandidates,
  type RawCandidateInput,
} from "./taxonomy-build";
import type { TaxonomyCandidate } from "./taxonomy-types";

/**
 * Pass B batch size. Scale is handled by batching, not by capping the
 * catalog — see `taxonomy-build.ts` for why this keeps every Pass B call's
 * output small regardless of store size.
 */
export const STAGE1_PASSB_BATCH_SIZE = 300;

export type Stage1CatalogPrep = {
  /**
   * Every candidate after deep-WooCommerce-descendant folding. Nothing is
   * dropped by product count here — the old `STAGE1_MAX_COLLECTIONS` cap
   * (150, sorted by productCount, silently discarding the tail) is gone.
   */
  candidates: TaxonomyCandidate[];
  /** Depth >= 2 WooCommerce descendants that never reach the model — see
   *  `foldDeepWooDescendants` for why folding them is lossless. */
  foldedItems: RawCandidateInput[];
  foldedInto: Map<string, string>;
  /** `candidates` split into Pass-B-sized batches. */
  batches: TaxonomyCandidate[][];
};

/**
 * Prepares a store's full collection + brand list for Stage 1 taxonomy
 * discovery. Unlike the old `compressCollectionsForStage1`, nothing is
 * capped or dropped by product count — every PLP either becomes its own
 * candidate or is folded losslessly into a kept ancestor (see
 * `taxonomy-build.ts`). A 5,000-PLP catalog produces more batches, never a
 * missing tail.
 */
export function prepareStage1Catalog(items: StoreCollectionItem[]): Stage1CatalogPrep {
  const { candidates, foldedInto, foldedItems } = buildTaxonomyCandidates(
    items as RawCandidateInput[]
  );
  const batches = batchCandidates(candidates, STAGE1_PASSB_BATCH_SIZE);
  return { candidates, foldedInto, foldedItems, batches };
}
