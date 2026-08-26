import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeywordRow } from "./providers/keyword-provider";

export const MARKET_RESEARCH_STORAGE_BUCKET = "workspace-files";

export type MrSliceName =
  | "catalog"
  | "products"
  | "niches"
  | "seeds"
  | "probes"
  | "keywords"
  | "collections"
  | "content"
  | "strategy"
  | "articles";

export function mrProjectPath(workspaceId: string, projectId: string): string {
  return `${workspaceId}/market-research/${projectId}`;
}

export function mrSlicePath(
  workspaceId: string,
  projectId: string,
  sliceName: MrSliceName
): string {
  return `${mrProjectPath(workspaceId, projectId)}/${sliceName}.json`;
}

export function mrKeywordsSamplePath(workspaceId: string, projectId: string): string {
  return mrSlicePath(workspaceId, projectId, "keywords");
}

export function mrExtractChunkPath(
  workspaceId: string,
  projectId: string,
  extractId: string,
  runId: string,
  offset: string
): string {
  const safeOffset = offset.replace(/[^a-zA-Z0-9._-]/g, "_") || "0";
  return `${mrProjectPath(workspaceId, projectId)}/extracts/${extractId}/${runId}/${safeOffset}.json`;
}

export async function saveMrJsonAdmin(
  admin: SupabaseClient,
  path: string,
  payload: unknown
): Promise<void> {
  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/octet-stream",
  });
  const { error } = await admin.storage
    .from(MARKET_RESEARCH_STORAGE_BUCKET)
    .upload(path, blob, {
      cacheControl: "0",
      upsert: true,
    });
  if (error) throw error;
}

export async function loadMrJsonAdmin<T>(
  admin: SupabaseClient,
  path: string
): Promise<T | null> {
  const { data, error } = await admin
    .storage
    .from(MARKET_RESEARCH_STORAGE_BUCKET)
    .download(path);
  if (error) {
    const message = error.message || "";
    if (/not found|object not found/i.test(message)) return null;
    throw error;
  }
  if (!data) return null;
  return JSON.parse(await data.text()) as T;
}

export async function saveProjectSliceAdmin<T>(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  sliceName: MrSliceName,
  payload: T
): Promise<string> {
  const path = mrSlicePath(workspaceId, projectId, sliceName);
  await saveMrJsonAdmin(admin, path, payload);
  return path;
}

export async function loadProjectSliceAdmin<T>(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  sliceName: MrSliceName
): Promise<T | null> {
  const path = mrSlicePath(workspaceId, projectId, sliceName);
  return loadMrJsonAdmin<T>(admin, path);
}

const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

/**
 * Walks every nesting level under `prefix` and returns file paths only.
 * Extract chunks live four levels deep (extracts/{extractId}/{runId}/{offset}.json),
 * so a single-level sweep leaves them behind forever.
 */
export async function listMrFilePathsAdmin(
  admin: SupabaseClient,
  prefix: string
): Promise<string[]> {
  const files: string[] = [];
  const pending: string[] = [prefix];

  while (pending.length > 0) {
    const folder = pending.pop()!;
    let offset = 0;
    for (;;) {
      const { data, error } = await admin.storage
        .from(MARKET_RESEARCH_STORAGE_BUCKET)
        .list(folder, { limit: LIST_PAGE_SIZE, offset });
      if (error || !data || data.length === 0) break;
      for (const item of data) {
        const path = `${folder}/${item.name}`;
        // Supabase marks real objects with an id; folders come back with id null.
        if (item.id) files.push(path);
        else pending.push(path);
      }
      if (data.length < LIST_PAGE_SIZE) break;
      offset += data.length;
    }
  }

  return files;
}

export async function deleteProjectStorageFolder(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<number> {
  const prefix = mrProjectPath(workspaceId, projectId);
  try {
    const paths = await listMrFilePathsAdmin(admin, prefix);
    let removed = 0;
    for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
      const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
      const { error } = await admin.storage
        .from(MARKET_RESEARCH_STORAGE_BUCKET)
        .remove(batch);
      if (error) {
        console.error(
          "[deleteProjectStorageFolder] Failed to remove batch:",
          error
        );
        continue;
      }
      removed += batch.length;
    }
    return removed;
  } catch (err) {
    console.error("[deleteProjectStorageFolder] Error cleaning storage folder:", err);
    return 0;
  }
}

/**
 * One page of raw provider rows. Self-describing so the archive can be read
 * without joining back to `mr_runs`.
 */
export type MrExtractChunk = {
  extractId: string;
  runId: string;
  seedId: string;
  seedTerm: string;
  offset: string;
  rowCount: number;
  savedAt: string;
  rows: KeywordRow[];
};

export async function saveExtractChunkAdmin(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    projectId: string;
    extractId: string;
    runId: string;
    seedId: string;
    seedTerm: string;
    offset: string;
    rows: KeywordRow[];
  }
): Promise<string | null> {
  if (input.rows.length === 0) return null;
  const path = mrExtractChunkPath(
    input.workspaceId,
    input.projectId,
    input.extractId,
    input.runId,
    input.offset
  );
  const chunk: MrExtractChunk = {
    extractId: input.extractId,
    runId: input.runId,
    seedId: input.seedId,
    seedTerm: input.seedTerm,
    offset: input.offset,
    rowCount: input.rows.length,
    savedAt: new Date().toISOString(),
    rows: input.rows,
  };
  await saveMrJsonAdmin(admin, path, chunk);
  return path;
}

export async function listExtractChunkPathsAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  extractId?: string
): Promise<string[]> {
  const base = `${mrProjectPath(workspaceId, projectId)}/extracts`;
  const prefix = extractId ? `${base}/${extractId}` : base;
  const paths = await listMrFilePathsAdmin(admin, prefix);
  return paths.filter((path) => path.endsWith(".json")).sort();
}

const CHUNK_READ_CONCURRENCY = 6;

/**
 * Rebuilds the complete paid keyword set from the chunk archive. `keywords.json`
 * only carries a capped display sample, so this is the single source for exports.
 */
export async function loadExtractRowsAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  extractId?: string
): Promise<KeywordRow[]> {
  const paths = await listExtractChunkPathsAdmin(
    admin,
    workspaceId,
    projectId,
    extractId
  );
  if (paths.length === 0) return [];

  const byPhrase = new Map<string, KeywordRow>();
  for (let i = 0; i < paths.length; i += CHUNK_READ_CONCURRENCY) {
    const batch = paths.slice(i, i + CHUNK_READ_CONCURRENCY);
    const chunks = await Promise.all(
      batch.map((path) =>
        loadMrJsonAdmin<MrExtractChunk>(admin, path).catch(() => null)
      )
    );
    for (const chunk of chunks) {
      if (!chunk || !Array.isArray(chunk.rows)) continue;
      for (const row of chunk.rows) {
        if (!row?.phrase) continue;
        const key = row.phrase.trim().toLowerCase();
        const existing = byPhrase.get(key);
        // Same phrase can surface under several seeds; keep the richer metric.
        if (!existing || (row.volume ?? 0) > (existing.volume ?? 0)) {
          byPhrase.set(key, row);
        }
      }
    }
  }

  return [...byPhrase.values()].sort(
    (a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.phrase.localeCompare(b.phrase)
  );
}
