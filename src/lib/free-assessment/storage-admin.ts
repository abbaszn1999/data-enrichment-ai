import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeywordRow } from "./providers/keyword-provider";
import type { MarketResearchProduct } from "@/components/free-assessment/workspace-data";
import { encodeVectorInt8, decodeVectorInt8 } from "./agent/embeddings";
import type { ClassifiedSheetType } from "./agent/stage4-intent-classifier";

export const FREE_ASSESSMENT_STORAGE_BUCKET = "workspace-files";

export type FaSliceName =
  | "catalog"
  | "products"
  | "niches"
  | "seeds"
  | "probes"
  | "keywords"
  | "collections"
  | "content"
  | "strategy"
  | "articles"
  | "internal-links";

/**
 * Merge-not-overwrite for cursor-driven writes: each page of a cursor job
 * (Stage 4 classification, Stage 5 clustering, …) only knows about its own
 * slice of records, so a plain overwrite of the stored slice would erase
 * every earlier page's results. This upserts `incoming` into `existing` by
 * id — later entries win on a collision — and preserves the relative order
 * of untouched existing entries followed by newly-appended ids.
 */
export function mergeById<T extends { id: string }>(
  existing: T[],
  incoming: T[]
): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

// ─── Sharded stores (products, product/term embeddings, classified keywords) ──
//
// These live under their own subfolders rather than in the single-file
// `FaSliceName` slices above, because each can hold tens of thousands of
// records — far past what a single JSON blob should carry. They are written
// append-only (each call adds a new shard file) and read via a small
// manifest that lists shard filenames in write order, so no call ever has to
// read-modify-write a giant file. `listFaFilePathsAdmin` / `deleteProjectStorageFolder`
// already walk arbitrary subfolders, so these need no changes there.

export function mrProductsShardPath(
  workspaceId: string,
  projectId: string,
  shard: string
): string {
  return `${mrProjectPath(workspaceId, projectId)}/products-shards/${shard}.json`;
}

export function mrProductsManifestPath(
  workspaceId: string,
  projectId: string
): string {
  return `${mrProjectPath(workspaceId, projectId)}/products-shards/manifest.json`;
}

export type ProductsManifest = {
  /** Shard filenames (without extension), in write order. */
  shards: string[];
  /**
   * Raw fetched-per-collection counts, not de-duplicated across collections.
   * Good enough for a "how many products behind this term" display; the
   * de-duplicated array length may be marginally lower when a product
   * legitimately belongs to two selected collections.
   */
  productCountByCollectionId: Record<string, number>;
  totalCount: number;
  done: boolean;
  updatedAt: string;
};

export type EmbeddingKind = "products" | "terms";

export function mrEmbeddingsShardPath(
  workspaceId: string,
  projectId: string,
  kind: EmbeddingKind,
  shard: string
): string {
  return `${mrProjectPath(workspaceId, projectId)}/embeddings/${kind}/${shard}.json`;
}

export function mrEmbeddingsManifestPath(
  workspaceId: string,
  projectId: string,
  kind: EmbeddingKind
): string {
  return `${mrProjectPath(workspaceId, projectId)}/embeddings/${kind}/manifest.json`;
}

export type EmbeddingManifest = {
  model: string;
  dims: number;
  encoding: "int8-unit";
  shards: string[];
  /** id -> content hash, so a re-run skips anything whose text hasn't changed. */
  hashes: Record<string, string>;
  count: number;
  updatedAt: string;
};

export function mrClassifiedShardPath(
  workspaceId: string,
  projectId: string,
  shard: string
): string {
  return `${mrProjectPath(workspaceId, projectId)}/classified/${shard}.json`;
}

export function mrClassifiedManifestPath(
  workspaceId: string,
  projectId: string
): string {
  return `${mrProjectPath(workspaceId, projectId)}/classified/manifest.json`;
}

export type ClassifiedManifest = {
  shards: string[];
  totalCount: number;
  categoryCount: number;
  informationalCount: number;
  excludedCount: number;
  done: boolean;
  updatedAt: string;
};

export function mrProjectPath(workspaceId: string, projectId: string): string {
  return `${workspaceId}/free-assessment/${projectId}`;
}

export function mrSlicePath(
  workspaceId: string,
  projectId: string,
  sliceName: FaSliceName
): string {
  return `${mrProjectPath(workspaceId, projectId)}/${sliceName}.json`;
}

export function mrKeywordsSamplePath(workspaceId: string, projectId: string): string {
  return mrSlicePath(workspaceId, projectId, "keywords");
}

export function FaExtractChunkPath(
  workspaceId: string,
  projectId: string,
  extractId: string,
  runId: string,
  offset: string
): string {
  const safeOffset = offset.replace(/[^a-zA-Z0-9._-]/g, "_") || "0";
  return `${mrProjectPath(workspaceId, projectId)}/extracts/${extractId}/${runId}/${safeOffset}.json`;
}

export async function saveFaJsonAdmin(
  admin: SupabaseClient,
  path: string,
  payload: unknown
): Promise<void> {
  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/octet-stream",
  });
  const { error } = await admin.storage
    .from(FREE_ASSESSMENT_STORAGE_BUCKET)
    .upload(path, blob, {
      cacheControl: "0",
      upsert: true,
    });
  if (error) throw error;
}

export async function loadFaJsonAdmin<T>(
  admin: SupabaseClient,
  path: string
): Promise<T | null> {
  const { data, error } = await admin
    .storage
    .from(FREE_ASSESSMENT_STORAGE_BUCKET)
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
  sliceName: FaSliceName,
  payload: T
): Promise<string> {
  const path = mrSlicePath(workspaceId, projectId, sliceName);
  await saveFaJsonAdmin(admin, path, payload);
  return path;
}

export async function loadProjectSliceAdmin<T>(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  sliceName: FaSliceName
): Promise<T | null> {
  const path = mrSlicePath(workspaceId, projectId, sliceName);
  return loadFaJsonAdmin<T>(admin, path);
}

const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

/**
 * Walks every nesting level under `prefix` and returns file paths only.
 * Extract chunks live four levels deep (extracts/{extractId}/{runId}/{offset}.json),
 * so a single-level sweep leaves them behind forever.
 */
export async function listFaFilePathsAdmin(
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
        .from(FREE_ASSESSMENT_STORAGE_BUCKET)
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
    const paths = await listFaFilePathsAdmin(admin, prefix);
    let removed = 0;
    for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
      const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
      const { error } = await admin.storage
        .from(FREE_ASSESSMENT_STORAGE_BUCKET)
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
 * without joining back to `fa_runs`.
 */
export type FaExtractChunk = {
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
  const path = FaExtractChunkPath(
    input.workspaceId,
    input.projectId,
    input.extractId,
    input.runId,
    input.offset
  );
  const chunk: FaExtractChunk = {
    extractId: input.extractId,
    runId: input.runId,
    seedId: input.seedId,
    seedTerm: input.seedTerm,
    offset: input.offset,
    rowCount: input.rows.length,
    savedAt: new Date().toISOString(),
    rows: input.rows,
  };
  await saveFaJsonAdmin(admin, path, chunk);
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
  const paths = await listFaFilePathsAdmin(admin, prefix);
  return paths.filter((path) => path.endsWith(".json")).sort();
}

const CHUNK_READ_CONCURRENCY = 6;

/** A raw archive row, stamped with the `seedId` its owning chunk was pulled for. */
export type ArchiveKeywordRow = KeywordRow & { seedId: string };

/**
 * Rebuilds the complete paid keyword set from the chunk archive — every raw
 * row exactly as pulled, per seed, with no cross-seed merging.
 *
 * `keywords.json` only carries a display cache, so this archive is the
 * single source of truth for exports and for full-scale Stage 4/5
 * processing.
 *
 * `opts.dedupe` (default `true`) collapses rows that share the exact same
 * phrase across different seeds down to one entry, kept for the classify
 * (`agent/intent`) and cluster (`agent/cluster`) routes so the AI stages
 * aren't billed/run twice for identical text. Pass `{ dedupe: false }` for
 * anything the merchant actually sees (CSV export, the Extract tab's
 * persisted sample) so what's shown always matches what was really pulled.
 */
export async function loadExtractRowsAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  extractId?: string,
  opts?: { dedupe?: boolean }
): Promise<ArchiveKeywordRow[]> {
  const paths = await listExtractChunkPathsAdmin(
    admin,
    workspaceId,
    projectId,
    extractId
  );
  if (paths.length === 0) return [];

  const allRows: ArchiveKeywordRow[] = [];
  for (let i = 0; i < paths.length; i += CHUNK_READ_CONCURRENCY) {
    const batch = paths.slice(i, i + CHUNK_READ_CONCURRENCY);
    const chunks = await Promise.all(
      batch.map((path) =>
        loadFaJsonAdmin<FaExtractChunk>(admin, path).catch(() => null)
      )
    );
    for (const chunk of chunks) {
      if (!chunk || !Array.isArray(chunk.rows)) continue;
      for (const row of chunk.rows) {
        if (!row?.phrase) continue;
        allRows.push({ ...row, seedId: chunk.seedId });
      }
    }
  }

  if (opts?.dedupe === false) {
    return allRows.sort(
      (a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.phrase.localeCompare(b.phrase)
    );
  }

  const byPhrase = new Map<string, ArchiveKeywordRow>();
  for (const row of allRows) {
    const key = row.phrase.trim().toLowerCase();
    const existing = byPhrase.get(key);
    // Same phrase can surface under several seeds; keep the richer metric.
    if (!existing || (row.volume ?? 0) > (existing.volume ?? 0)) {
      byPhrase.set(key, row);
    }
  }

  return [...byPhrase.values()].sort(
    (a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.phrase.localeCompare(b.phrase)
  );
}

// ─── Products (paginated catalog fetch) ────────────────────────────────────

function nextShardName(existingShards: string[]): string {
  return String(existingShards.length).padStart(6, "0");
}

/** Writes a new products shard and folds its counts into the manifest. Append-only. */
export async function appendProductsShardAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  products: MarketResearchProduct[],
  opts: { done: boolean }
): Promise<ProductsManifest> {
  const manifest =
    (await loadFaJsonAdmin<ProductsManifest>(
      admin,
      mrProductsManifestPath(workspaceId, projectId)
    )) ?? {
      shards: [],
      productCountByCollectionId: {},
      totalCount: 0,
      done: false,
      updatedAt: new Date().toISOString(),
    };

  if (products.length > 0) {
    const shard = nextShardName(manifest.shards);
    await saveFaJsonAdmin(
      admin,
      mrProductsShardPath(workspaceId, projectId, shard),
      products
    );
    manifest.shards.push(shard);
    manifest.totalCount += products.length;
    for (const p of products) {
      for (const cid of p.collectionIds) {
        manifest.productCountByCollectionId[cid] =
          (manifest.productCountByCollectionId[cid] ?? 0) + 1;
      }
    }
  }
  manifest.done = opts.done;
  manifest.updatedAt = new Date().toISOString();

  await saveFaJsonAdmin(
    admin,
    mrProductsManifestPath(workspaceId, projectId),
    manifest
  );
  return manifest;
}

export async function loadProductsManifestAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<ProductsManifest | null> {
  return loadFaJsonAdmin<ProductsManifest>(
    admin,
    mrProductsManifestPath(workspaceId, projectId)
  );
}

const SHARD_READ_CONCURRENCY = 6;

/**
 * Reads every product shard and merges duplicate ids (a product can
 * legitimately appear under two selected collections, fetched in different
 * calls) by unioning `collectionIds`/`collectionNames` rather than
 * overwriting. Falls back to the legacy single-file `products` slice for
 * projects created before sharding existed.
 */
export async function loadProjectProducts(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<MarketResearchProduct[]> {
  const manifest = await loadProductsManifestAdmin(admin, workspaceId, projectId);

  if (!manifest || manifest.shards.length === 0) {
    const legacy = await loadProjectSliceAdmin<MarketResearchProduct[]>(
      admin,
      workspaceId,
      projectId,
      "products"
    ).catch(() => null);
    return Array.isArray(legacy) ? legacy : [];
  }

  const byId = new Map<string, MarketResearchProduct>();
  for (let i = 0; i < manifest.shards.length; i += SHARD_READ_CONCURRENCY) {
    const batch = manifest.shards.slice(i, i + SHARD_READ_CONCURRENCY);
    const shardLists = await Promise.all(
      batch.map((shard) =>
        loadFaJsonAdmin<MarketResearchProduct[]>(
          admin,
          mrProductsShardPath(workspaceId, projectId, shard)
        ).catch(() => null)
      )
    );
    for (const list of shardLists) {
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        const existing = byId.get(p.id);
        if (!existing) {
          byId.set(p.id, { ...p });
          continue;
        }
        for (const cid of p.collectionIds) {
          if (!existing.collectionIds.includes(cid)) {
            existing.collectionIds.push(cid);
          }
        }
        for (const cname of p.collectionNames) {
          if (!existing.collectionNames.includes(cname)) {
            existing.collectionNames.push(cname);
          }
        }
      }
    }
  }
  return Array.from(byId.values());
}

// ─── Embeddings (products + category terms) ───────────────────────────────

export type EmbeddingShardItem = {
  id: string;
  hash: string;
  vector: string; // int8-unit base64, see encodeVectorInt8
  /** Only set for term embeddings — the collection this term is scoped to. */
  collectionId?: string;
};

export async function loadEmbeddingsManifestAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  kind: EmbeddingKind
): Promise<EmbeddingManifest | null> {
  return loadFaJsonAdmin<EmbeddingManifest>(
    admin,
    mrEmbeddingsManifestPath(workspaceId, projectId, kind)
  );
}

/**
 * Appends a new embeddings shard (skipping nothing — callers pre-filter by
 * hash before calling) and folds the id->hash map into the manifest so the
 * next pass can skip unchanged text.
 */
export async function appendEmbeddingsShardAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  kind: EmbeddingKind,
  items: EmbeddingShardItem[],
  model: string,
  dims: number
): Promise<EmbeddingManifest> {
  const manifest =
    (await loadEmbeddingsManifestAdmin(admin, workspaceId, projectId, kind)) ?? {
      model,
      dims,
      encoding: "int8-unit" as const,
      shards: [],
      hashes: {},
      count: 0,
      updatedAt: new Date().toISOString(),
    };

  if (items.length > 0) {
    const shard = nextShardName(manifest.shards);
    await saveFaJsonAdmin(
      admin,
      mrEmbeddingsShardPath(workspaceId, projectId, kind, shard),
      items
    );
    manifest.shards.push(shard);
    manifest.count += items.length;
    for (const item of items) {
      manifest.hashes[item.id] = item.hash;
    }
  }
  manifest.updatedAt = new Date().toISOString();

  await saveFaJsonAdmin(
    admin,
    mrEmbeddingsManifestPath(workspaceId, projectId, kind),
    manifest
  );
  return manifest;
}

export type DecodedEmbedding = {
  hash: string;
  vector: number[];
  collectionId?: string;
};

/** Reads every shard for a kind and decodes vectors back to float arrays. */
export async function loadEmbeddingsMap(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  kind: EmbeddingKind
): Promise<Map<string, DecodedEmbedding>> {
  const manifest = await loadEmbeddingsManifestAdmin(admin, workspaceId, projectId, kind);
  const out = new Map<string, DecodedEmbedding>();
  if (!manifest || manifest.shards.length === 0) return out;

  for (let i = 0; i < manifest.shards.length; i += SHARD_READ_CONCURRENCY) {
    const batch = manifest.shards.slice(i, i + SHARD_READ_CONCURRENCY);
    const shardLists = await Promise.all(
      batch.map((shard) =>
        loadFaJsonAdmin<EmbeddingShardItem[]>(
          admin,
          mrEmbeddingsShardPath(workspaceId, projectId, kind, shard)
        ).catch(() => null)
      )
    );
    for (const list of shardLists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        out.set(item.id, {
          hash: item.hash,
          vector: decodeVectorInt8(item.vector, manifest.dims),
          collectionId: item.collectionId,
        });
      }
    }
  }
  return out;
}

/** Encodes vectors to the persisted int8 form. Thin re-export for route callers. */
export { encodeVectorInt8 };

// ─── Classified keywords (full Stage 4 archive, not the 1.5k UI sample) ───

export type ClassifiedShardItem = {
  id: string;
  keyword: string;
  seedId: string;
  sheet: ClassifiedSheetType;
  reason: string;
  plpConcept?: string;
};

export async function loadClassifiedManifestAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<ClassifiedManifest | null> {
  return loadFaJsonAdmin<ClassifiedManifest>(
    admin,
    mrClassifiedManifestPath(workspaceId, projectId)
  );
}

export async function appendClassifiedShardAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  items: ClassifiedShardItem[],
  opts: { done: boolean }
): Promise<ClassifiedManifest> {
  const manifest =
    (await loadClassifiedManifestAdmin(admin, workspaceId, projectId)) ?? {
      shards: [],
      totalCount: 0,
      categoryCount: 0,
      informationalCount: 0,
      excludedCount: 0,
      done: false,
      updatedAt: new Date().toISOString(),
    };

  if (items.length > 0) {
    const shard = nextShardName(manifest.shards);
    await saveFaJsonAdmin(
      admin,
      mrClassifiedShardPath(workspaceId, projectId, shard),
      items
    );
    manifest.shards.push(shard);
    manifest.totalCount += items.length;
    for (const item of items) {
      if (item.sheet === "category") manifest.categoryCount += 1;
      else if (item.sheet === "informational") manifest.informationalCount += 1;
      else manifest.excludedCount += 1;
    }
  }
  manifest.done = opts.done;
  manifest.updatedAt = new Date().toISOString();

  await saveFaJsonAdmin(
    admin,
    mrClassifiedManifestPath(workspaceId, projectId),
    manifest
  );
  return manifest;
}

export async function loadClassifiedCategoryTerms(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<ClassifiedShardItem[]> {
  const manifest = await loadClassifiedManifestAdmin(admin, workspaceId, projectId);
  if (!manifest || manifest.shards.length === 0) return [];

  const out: ClassifiedShardItem[] = [];
  for (let i = 0; i < manifest.shards.length; i += SHARD_READ_CONCURRENCY) {
    const batch = manifest.shards.slice(i, i + SHARD_READ_CONCURRENCY);
    const shardLists = await Promise.all(
      batch.map((shard) =>
        loadFaJsonAdmin<ClassifiedShardItem[]>(
          admin,
          mrClassifiedShardPath(workspaceId, projectId, shard)
        ).catch(() => null)
      )
    );
    for (const list of shardLists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item.sheet === "category") out.push(item);
      }
    }
  }
  return out;
}
