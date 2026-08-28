import { createAdminClient } from "@/lib/supabase-admin";
import {
  LEDGER_PAGE_SIZE,
  type DateWindow,
  type SortDir,
  type SortState,
} from "@/lib/platform-admin/list-query";

export type LedgerPage<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type LedgerParams = {
  page: number;
  pageSize: number;
  q: string;
  dateWindow: DateWindow;
  sort: SortState;
};

const DATE_WINDOWS = new Set<DateWindow>(["all", "7d", "30d", "90d"]);

export function parseDateWindow(value: string | null): DateWindow {
  if (value && DATE_WINDOWS.has(value as DateWindow)) return value as DateWindow;
  return "all";
}

export function parseLedgerParams(
  searchParams: URLSearchParams,
  allowedSort: string[],
  fallbackSort: SortState
): LedgerParams {
  const page = Math.max(1, Math.floor(Number(searchParams.get("page") || 1)) || 1);
  const requestedSize = Math.floor(Number(searchParams.get("pageSize") || LEDGER_PAGE_SIZE)) || LEDGER_PAGE_SIZE;
  const pageSize = Math.min(100, Math.max(1, requestedSize));
  const sortKey = searchParams.get("sort") || fallbackSort.key;
  const dirRaw = searchParams.get("dir");
  const dir: SortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : fallbackSort.dir;
  return {
    page,
    pageSize,
    q: (searchParams.get("q") || "").trim(),
    dateWindow: parseDateWindow(searchParams.get("window")),
    sort: {
      key: allowedSort.includes(sortKey) ? sortKey : fallbackSort.key,
      dir,
    },
  };
}

export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function dateWindowSinceIso(window: DateWindow): string | null {
  if (window === "all") return null;
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function postgrestIn(column: string, ids: string[]): string | null {
  if (!ids.length) return null;
  const quoted = ids.map((id) => `"${id.replace(/"/g, "")}"`);
  return `${column}.in.(${quoted.join(",")})`;
}

export function postgrestOr(parts: Array<string | null | undefined>): string | null {
  const clean = parts.filter((part): part is string => Boolean(part));
  return clean.length ? clean.join(",") : null;
}

export function postgrestIlike(column: string, q: string): string | null {
  const cleaned = q.replace(/[,()]/g, " ").trim();
  if (!cleaned) return null;
  return `${column}.ilike.%${escapeIlike(cleaned)}%`;
}

export function keysMatchingLabel(q: string, labels: Record<string, string>): string[] {
  const needle = q.toLowerCase();
  return Object.entries(labels)
    .filter(([key, label]) => key.toLowerCase().includes(needle) || label.toLowerCase().includes(needle))
    .map(([key]) => key);
}

export function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function lookupNames(userIds: string[], workspaceIds: string[]) {
  const admin = createAdminClient();
  const uniqueUsers = [...new Set(userIds.filter(Boolean))];
  const uniqueWorkspaces = [...new Set(workspaceIds.filter(Boolean))];
  const [profiles, workspaces] = await Promise.all([
    uniqueUsers.length
      ? admin.from("profiles").select("id, full_name").in("id", uniqueUsers)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[], error: null }),
    uniqueWorkspaces.length
      ? admin.from("workspaces").select("id, name").in("id", uniqueWorkspaces)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  if (workspaces.error) throw new Error(workspaces.error.message);

  const nameById = new Map<string, string>();
  for (const row of profiles.data ?? []) {
    const name = (row.full_name || "").trim();
    nameById.set(row.id, name || row.id);
  }
  const workspaceNameById = new Map<string, string>();
  for (const row of workspaces.data ?? []) {
    workspaceNameById.set(row.id, row.name || row.id);
  }
  return { nameById, workspaceNameById };
}

export async function searchIdentityIds(q: string): Promise<{ userIds: string[]; workspaceIds: string[] }> {
  const admin = createAdminClient();
  const pattern = `%${escapeIlike(q)}%`;
  const [{ data: profiles, error: profileError }, byName, bySlug] = await Promise.all([
    admin.from("profiles").select("id").ilike("full_name", pattern).limit(200),
    admin.from("workspaces").select("id").ilike("name", pattern).limit(200),
    admin.from("workspaces").select("id").ilike("slug", pattern).limit(200),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (byName.error) throw new Error(byName.error.message);
  if (bySlug.error) throw new Error(bySlug.error.message);
  return {
    userIds: (profiles ?? []).map((row) => row.id as string),
    workspaceIds: [...new Set([
      ...(byName.data ?? []).map((row) => row.id as string),
      ...(bySlug.data ?? []).map((row) => row.id as string),
    ])],
  };
}
