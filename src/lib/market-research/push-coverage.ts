import type { ProposedCollection } from "@/components/market-research/workspace-data";

/**
 * The $5 push is the only charge for a collection and also pays for its
 * on-page copy, internal links and articles. Only the push route writes store
 * ids, so the browser cannot mark a collection as paid.
 */
export function isPushedCollection(
  col: Pick<ProposedCollection, "storeHandle" | "storeCollectionId"> | null | undefined
): boolean {
  return Boolean(col?.storeHandle || col?.storeCollectionId);
}
