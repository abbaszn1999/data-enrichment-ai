import type { ProposedCollection } from "@/components/market-research/workspace-data";

export type CollectionSheetFilters = {
  query: string;
  minVolume: number;
  maxKd: number;
  minProducts: number;
};

export type CollectionStatusView = "all" | "new" | "duplicate";

export const DEFAULT_COLLECTION_FILTERS: CollectionSheetFilters = {
  query: "",
  minVolume: 0,
  maxKd: 100,
  minProducts: 0,
};

export function collectionFiltersEqual(
  a: CollectionSheetFilters,
  b: CollectionSheetFilters
): boolean {
  return (
    a.query === b.query &&
    a.minVolume === b.minVolume &&
    a.maxKd === b.maxKd &&
    a.minProducts === b.minProducts
  );
}

export function filterProposedCollections(
  collections: ProposedCollection[],
  filters: CollectionSheetFilters,
  statusFilter: CollectionStatusView
): ProposedCollection[] {
  const q = filters.query.trim().toLowerCase();
  return collections.filter((row) => {
    if (statusFilter === "duplicate" && row.status !== "duplicate") return false;
    if (statusFilter === "new" && row.status === "duplicate") return false;
    if (row.volume < filters.minVolume) return false;
    if (row.difficulty > filters.maxKd) return false;
    if (row.productCount < filters.minProducts) return false;
    if (q) {
      const matchName = row.name.toLowerCase().includes(q);
      const matchHead = row.headKeyword.toLowerCase().includes(q);
      const matchNiche = row.parentNiche.toLowerCase().includes(q);
      if (!matchName && !matchHead && !matchNiche) return false;
    }
    return true;
  });
}

export function unionSelectedIds(current: string[], add: string[]): string[] {
  const next = new Set(current);
  for (const id of add) next.add(id);
  return Array.from(next);
}

export function removeSelectedIds(current: string[], remove: string[]): string[] {
  const drop = new Set(remove);
  return current.filter((id) => !drop.has(id));
}

export function pageSelectionState(pageIds: string[], selected: Set<string>) {
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  return {
    allSelected: pageIds.length > 0 && selectedOnPage === pageIds.length,
    someSelected: selectedOnPage > 0 && selectedOnPage < pageIds.length,
  };
}

export function selectedDuplicateIds(
  collections: ProposedCollection[],
  selected: Set<string>
): string[] {
  return collections
    .filter((c) => selected.has(c.id) && c.status === "duplicate")
    .map((c) => c.id);
}

export const WORKSHEET_PAGE_SIZE = 50;

/** Drop only the ids about to be regenerated; leave everyone else's copy intact. */
export function clearSelectedContent<T>(
  current: Record<string, T>,
  ids: string[]
): Record<string, T> {
  if (ids.length === 0) return current;
  const drop = new Set(ids);
  const next: Record<string, T> = {};
  for (const [id, value] of Object.entries(current)) {
    if (!drop.has(id)) next[id] = value;
  }
  return next;
}
