import type { ColumnFilters } from "@/lib/sheet/column-filters";

/**
 * The part of the owner's sheet view a share link opens with: column filters,
 * sort, search, the status tab and the Existing/New tab. Stored on the share
 * link and re-applied as the starting view on the public page. Pure, so both
 * the owner sheets and the public API can use it.
 */
export interface ShareView {
  /** Allowed values per column key (same keys the sheet's own filters use). */
  columnFilters?: Record<string, string[]>;
  sort?: { column: string; direction: "asc" | "desc" } | null;
  /** Catalog search box text. */
  search?: string;
  /** Catalog status tab: "pending" | "done" | "error" (absent means all). */
  status?: string;
  /** Catalog Existing / New sheet tab. */
  activeSheet?: "existing" | "new";
}

const MAX_FILTER_COLUMNS = 60;
const MAX_VALUES_PER_COLUMN = 500;
const MAX_TEXT_CHARS = 500;
const STATUS_VALUES = new Set(["pending", "processing", "done", "error"]);

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) : value;
}

/**
 * Makes anything read from the database or a request body safe to apply:
 * unknown keys are dropped, sizes are capped. Returns null when nothing is left.
 */
export function sanitizeShareView(raw: unknown): ShareView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const view: ShareView = {};

  if (input.columnFilters && typeof input.columnFilters === "object" && !Array.isArray(input.columnFilters)) {
    const filters: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(input.columnFilters as Record<string, unknown>)) {
      if (Object.keys(filters).length >= MAX_FILTER_COLUMNS) break;
      if (!Array.isArray(values)) continue;
      const cleaned = values
        .slice(0, MAX_VALUES_PER_COLUMN)
        .map(cleanText)
        .filter((value): value is string => value !== null);
      if (cleaned.length > 0) filters[key.slice(0, MAX_TEXT_CHARS)] = cleaned;
    }
    if (Object.keys(filters).length > 0) view.columnFilters = filters;
  }

  const sort = input.sort as { column?: unknown; direction?: unknown } | null | undefined;
  if (sort && typeof sort === "object") {
    const column = cleanText(sort.column);
    if (column) view.sort = { column, direction: sort.direction === "desc" ? "desc" : "asc" };
  }

  const search = cleanText(input.search)?.trim();
  if (search) view.search = search;

  if (typeof input.status === "string" && STATUS_VALUES.has(input.status)) view.status = input.status;

  if (input.activeSheet === "existing" || input.activeSheet === "new") view.activeSheet = input.activeSheet;

  return Object.keys(view).length > 0 ? view : null;
}

export function columnFiltersToView(filters: ColumnFilters): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(filters)) {
    if (values.size > 0) out[key] = [...values];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function viewToColumnFilters(view: ShareView | null | undefined): ColumnFilters {
  const filters: ColumnFilters = {};
  for (const [key, values] of Object.entries(view?.columnFilters ?? {})) {
    if (values.length > 0) filters[key] = new Set(values);
  }
  return filters;
}

/**
 * A view built from a sheet's raw state. Absent or default parts are left out,
 * so a sheet nobody has filtered produces `null` and the link opens unfiltered.
 */
export function buildShareView(state: {
  columnFilters?: ColumnFilters;
  sort?: { column: string; direction: "asc" | "desc" } | null;
  search?: string;
  status?: string;
  activeSheet?: "existing" | "new";
}): ShareView | null {
  return sanitizeShareView({
    columnFilters: state.columnFilters ? columnFiltersToView(state.columnFilters) : undefined,
    sort: state.sort ?? undefined,
    search: state.search,
    status: state.status && state.status !== "all" ? state.status : undefined,
    // The shared page already opens on "new", so only "existing" is worth saving.
    activeSheet: state.activeSheet === "existing" ? "existing" : undefined,
  });
}

/** "2 column filters, search, sorted" — shown in the Share popup. */
export function describeShareView(view: ShareView | null | undefined): string {
  if (!view) return "";
  const parts: string[] = [];
  if (view.activeSheet === "existing") parts.push("Existing sheet");
  const filterCount = Object.keys(view.columnFilters ?? {}).length;
  if (filterCount > 0) parts.push(`${filterCount} column filter${filterCount === 1 ? "" : "s"}`);
  if (view.status) parts.push(`${view.status} rows`);
  if (view.search) parts.push("search");
  if (view.sort) parts.push("sorted");
  return parts.join(", ");
}

/** Stable text for comparing two views (key order does not matter). */
export function shareViewKey(view: ShareView | null | undefined): string {
  if (!view) return "";
  const filters = Object.entries(view.columnFilters ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => [key, [...values].sort()]);
  return JSON.stringify({ ...view, columnFilters: filters });
}
