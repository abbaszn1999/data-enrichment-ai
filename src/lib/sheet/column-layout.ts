/**
 * Column order + visibility, shared by Catalog Intelligence, Product Gallery
 * and the Visualizer sheets. A column is identified by a stable string key
 * (e.g. `orig:Brand`, `enrich:imageUrls`, or a module's own result-column
 * key) — the layout itself never knows what a key means, so the same helper
 * works for source columns mixed freely with AI/result columns.
 *
 * Pure and framework-free so it is cheap to unit test and safe to reuse from
 * both React state (Catalog) and Zod-validated settings (Gallery/Visualizer).
 */

import type { ColumnLayout } from "@/types";
export type { ColumnLayout };

export const EMPTY_COLUMN_LAYOUT: ColumnLayout = { order: [], hidden: [] };

/**
 * Visible keys in saved order. A key present in `allKeys` but missing from
 * `order` (a newly added column) is appended in its natural position; a key
 * in `order` no longer in `allKeys` (a removed column) is dropped silently.
 */
export function applyColumnLayout(allKeys: string[], layout: ColumnLayout | undefined | null): string[] {
  const known = new Set(allKeys);
  const hidden = new Set(layout?.hidden ?? []);
  const ordered = (layout?.order ?? []).filter((key) => known.has(key));
  const seen = new Set(ordered);
  for (const key of allKeys) {
    if (!seen.has(key)) {
      ordered.push(key);
      seen.add(key);
    }
  }
  return ordered.filter((key) => !hidden.has(key));
}

/** Every known key in saved order, including hidden ones — for the layout panel's full list. */
export function fullColumnOrder(allKeys: string[], layout: ColumnLayout | undefined | null): string[] {
  const known = new Set(allKeys);
  const ordered = (layout?.order ?? []).filter((key) => known.has(key));
  const seen = new Set(ordered);
  for (const key of allKeys) {
    if (!seen.has(key)) {
      ordered.push(key);
      seen.add(key);
    }
  }
  return ordered;
}

/**
 * Moves `fromKey` to `toKey`'s position in the full (including hidden)
 * order — same splice semantics as the existing `reorderColumns` action:
 * remove at `fromIndex`, then insert at `toIndex` of the resulting array.
 */
export function moveColumn(layout: ColumnLayout | undefined | null, allKeys: string[], fromKey: string, toKey: string): ColumnLayout {
  const order = fullColumnOrder(allKeys, layout);
  const fromIndex = order.indexOf(fromKey);
  const toIndex = order.indexOf(toKey);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return { order, hidden: layout?.hidden ?? [] };
  }
  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return { order: next, hidden: layout?.hidden ?? [] };
}

/**
 * Rearranges the keys of one group into `orderedGroup`'s order, using only the
 * slots those keys already hold in the full order: every other key stays put.
 */
export function reorderKeysInPlace(
  layout: ColumnLayout | undefined | null,
  allKeys: string[],
  orderedGroup: string[]
): ColumnLayout {
  const order = fullColumnOrder(allKeys, layout);
  const present = new Set(order);
  const queue = [...new Set(orderedGroup)].filter((key) => present.has(key));
  const inGroup = new Set(queue);
  let next = 0;
  return {
    order: order.map((key) => (inGroup.has(key) ? queue[next++]! : key)),
    hidden: layout?.hidden ?? [],
  };
}

export function toggleColumnHidden(layout: ColumnLayout | undefined | null, allKeys: string[], key: string): ColumnLayout {
  const order = fullColumnOrder(allKeys, layout);
  const hiddenSet = new Set(layout?.hidden ?? []);
  if (hiddenSet.has(key)) hiddenSet.delete(key);
  else hiddenSet.add(key);
  return { order, hidden: [...hiddenSet] };
}

export function isColumnHidden(layout: ColumnLayout | undefined | null, key: string): boolean {
  return (layout?.hidden ?? []).includes(key);
}
