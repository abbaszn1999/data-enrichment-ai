import type { AnalyticsDateRange } from "./types";

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseAnalyticsDateRange(value: string | null | undefined): AnalyticsDateRange {
  if (value === "7" || value === "28" || value === "90") return value;
  return "28";
}

export function analyticsRangeStorageKey(workspaceId: string): string {
  return `analytics-range:${workspaceId}`;
}

const rangeMemory = new Map<string, AnalyticsDateRange>();

export function peekAnalyticsDateRange(workspaceId: string | null | undefined): AnalyticsDateRange | null {
  if (!workspaceId) return null;
  return rangeMemory.get(workspaceId) ?? null;
}

export function readStoredAnalyticsDateRange(workspaceId: string | null | undefined): AnalyticsDateRange {
  if (!workspaceId) return "28";
  const remembered = rangeMemory.get(workspaceId);
  if (remembered) return remembered;
  if (typeof window === "undefined") return "28";
  try {
    const stored = parseAnalyticsDateRange(window.localStorage.getItem(analyticsRangeStorageKey(workspaceId)));
    rangeMemory.set(workspaceId, stored);
    return stored;
  } catch {
    return "28";
  }
}

export function storeAnalyticsDateRange(workspaceId: string, range: AnalyticsDateRange): void {
  rangeMemory.set(workspaceId, range);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(analyticsRangeStorageKey(workspaceId), range);
  } catch {
    // Private mode / quota — the in-memory range still works for this session.
  }
}

/** Inclusive current window plus the matching previous window, matching the prior analytics tool. */
export function analyticsDateWindows(days: number, now = new Date()) {
  const end = utcDay(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - days + 1);

  return {
    startDate: isoDay(start),
    endDate: isoDay(end),
    prevStartDate: isoDay(prevStart),
    prevEndDate: isoDay(prevEnd),
  };
}

export function ga4DateToIso(value: string): string {
  const compact = value.replace(/-/g, "");
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return value;
}

export function comparisonLabel(days: number): string {
  return `vs. previous ${days} days`;
}
