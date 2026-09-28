/**
 * Excel-style per-column value filters, shared by Catalog Intelligence,
 * Product Gallery and the Visualizer sheets. A filter is a set of allowed
 * values for one column key; no entry for a key means that column is
 * unfiltered. Filters from different columns combine with AND.
 *
 * Pure and framework-free. Callers supply `getValue(row)` per column so this
 * module never needs to know a row's shape.
 */

export const BLANK_VALUE = "\u0000(Blanks)";
export const BLANK_LABEL = "(Blanks)";

/** Allowed values per column key. Absent key = no filter on that column. */
export type ColumnFilters = Record<string, Set<string>>;

export interface FilterValueOption {
  value: string;
  label: string;
  count: number;
}

/** Distinct values of one column across `rows`, most common first, blanks last. */
export function columnFilterValues<T>(rows: T[], getValue: (row: T) => string): FilterValueOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = getValue(row).trim();
    const value = raw === "" ? BLANK_VALUE : raw;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const blanks = counts.get(BLANK_VALUE);
  counts.delete(BLANK_VALUE);
  const options = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: value, count }));
  if (blanks) options.push({ value: BLANK_VALUE, label: BLANK_LABEL, count: blanks });
  return options;
}

/** Bucket-based options (e.g. image-column statuses) with counts computed against `rows`. */
export function bucketFilterValues<T>(
  rows: T[],
  buckets: Array<{ value: string; label: string }>,
  getBucket: (row: T) => string
): FilterValueOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const bucket = getBucket(row);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return buckets
    .map((bucket) => ({ ...bucket, count: counts.get(bucket.value) ?? 0 }))
    .filter((bucket) => bucket.count > 0);
}

/** AND across every filtered column; a column with no entry never excludes a row. */
export function applyColumnFilters<T>(
  rows: T[],
  filters: ColumnFilters,
  getValue: (row: T, columnKey: string) => string
): T[] {
  const active = Object.entries(filters).filter(([, values]) => values.size > 0);
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every(([columnKey, values]) => {
      const raw = getValue(row, columnKey).trim();
      return values.has(raw === "" ? BLANK_VALUE : raw);
    })
  );
}

export function hasActiveFilters(filters: ColumnFilters): boolean {
  return Object.values(filters).some((values) => values.size > 0);
}

export function setColumnFilter(filters: ColumnFilters, columnKey: string, values: Set<string>): ColumnFilters {
  const next = { ...filters };
  if (values.size === 0) delete next[columnKey];
  else next[columnKey] = values;
  return next;
}

export function clearColumnFilter(filters: ColumnFilters, columnKey: string): ColumnFilters {
  const next = { ...filters };
  delete next[columnKey];
  return next;
}
