import { createAdminClient } from "@/lib/supabase-admin";

export type WorkspaceUsage = {
  storageBytes: number;
  objectCount: number;
  dbBytes: number;
};

export const EMPTY_USAGE: WorkspaceUsage = {
  storageBytes: 0,
  objectCount: 0,
  dbBytes: 0,
};

type UsageRpcRow = {
  workspace_id: string;
  storage_bytes: number | string | null;
  object_count: number | string | null;
  db_bytes: number | string | null;
};

let cache: { expires: number; promise: Promise<Map<string, WorkspaceUsage>> } | null = null;
const CACHE_MS = 4_000;

function asCount(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function fetchWorkspaceUsage(): Promise<Map<string, WorkspaceUsage>> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_workspace_usage");
  if (error) throw new Error(error.message);

  const map = new Map<string, WorkspaceUsage>();
  for (const row of (data ?? []) as UsageRpcRow[]) {
    map.set(row.workspace_id, {
      storageBytes: asCount(row.storage_bytes),
      objectCount: asCount(row.object_count),
      dbBytes: asCount(row.db_bytes),
    });
  }
  return map;
}

export async function loadWorkspaceUsageMap(): Promise<Map<string, WorkspaceUsage>> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.promise;
  const promise = fetchWorkspaceUsage().catch((error) => {
    cache = null;
    throw error;
  });
  cache = { expires: now + CACHE_MS, promise };
  return promise;
}

export function usageOf(map: Map<string, WorkspaceUsage>, workspaceId: string): WorkspaceUsage {
  return map.get(workspaceId) ?? EMPTY_USAGE;
}

export function sumUsage(usages: WorkspaceUsage[]): WorkspaceUsage {
  return usages.reduce(
    (acc, row) => ({
      storageBytes: acc.storageBytes + row.storageBytes,
      objectCount: acc.objectCount + row.objectCount,
      dbBytes: acc.dbBytes + row.dbBytes,
    }),
    { ...EMPTY_USAGE }
  );
}
