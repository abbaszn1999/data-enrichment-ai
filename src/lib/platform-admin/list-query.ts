export type SortDir = "asc" | "desc";

export type SortState = {
  key: string;
  dir: SortDir;
};

export type DateWindow = "all" | "7d" | "30d" | "90d";

export const DATE_WINDOW_OPTIONS = [
  { value: "all", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;

export const PLAN_FILTER_OPTIONS = [
  { value: "all", label: "All plans" },
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "pro", label: "Pro" },
];

export function inDateWindow(iso: string | null | undefined, window: DateWindow): boolean {
  if (window === "all") return true;
  if (!iso) return false;
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 90;
  return Date.now() - new Date(iso).getTime() <= days * 86_400_000;
}

export function matchesLastSeen(
  iso: string | null | undefined,
  window: "all" | "7d" | "30d" | "stale" | "never"
): boolean {
  if (window === "all") return true;
  if (window === "never") return !iso;
  if (!iso) return false;
  const age = Date.now() - new Date(iso).getTime();
  if (window === "stale") return age > 30 * 86_400_000;
  const days = window === "7d" ? 7 : 30;
  return age <= days * 86_400_000;
}

export function toggleSort(current: SortState | null, key: string): SortState {
  if (current?.key !== key) return { key, dir: "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

type Sortable = string | number | boolean | null | undefined;

function compareValues(a: Sortable, b: Sortable): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function sortRows<T>(
  rows: T[],
  sort: SortState | null,
  getters: Record<string, (row: T) => Sortable>
): T[] {
  if (!sort) return rows;
  const get = getters[sort.key];
  if (!get) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => compareValues(get(a), get(b)) * dir);
}
