/**
 * Server-side storage helpers for API routes.
 * Uses supabase-server (cookies-based) instead of supabase-browser.
 */
import { createClient } from "@/lib/supabase-server";
import type { ProjectJson, MasterProductJson, CategoryJson, ImageClassificationJson } from "@/lib/storage-helpers";
import { getCategoriesStoragePath, getCategoriesRawStoragePath, getImageClassificationResultPath } from "@/lib/storage-helpers";

const BUCKET = "workspace-files";

export async function loadJsonFromStorageServer<T = unknown>(storagePath: string): Promise<T | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);
  if (error) {
    if (error.message?.includes("not found") || error.message?.includes("Object not found")) return null;
    throw error;
  }
  const text = await data.text();
  return JSON.parse(text) as T;
}

export async function saveJsonToStorageServer(storagePath: string, data: unknown): Promise<void> {
  const supabase = await createClient();
  const blob = new Blob([JSON.stringify(data)], { type: "application/octet-stream" });
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, blob, { cacheControl: "0", upsert: true });
  if (error) throw error;
}

export function getProjectStoragePath(workspaceId: string, sessionId: string): string {
  return `${workspaceId}/projects/${sessionId}.json`;
}

export function getProductsStoragePath(workspaceId: string): string {
  return `${workspaceId}/master/products.json`;
}

export async function loadProjectJsonServer(workspaceId: string, sessionId: string): Promise<ProjectJson | null> {
  return loadJsonFromStorageServer<ProjectJson>(getProjectStoragePath(workspaceId, sessionId));
}

export async function saveProjectJsonServer(workspaceId: string, sessionId: string, data: ProjectJson): Promise<void> {
  await saveJsonToStorageServer(getProjectStoragePath(workspaceId, sessionId), data);
}

// ─── Server-side Caching of Counts (prevents downloading massive JSONs repeatedly) ───
//
// Counting used to download + parse the ENTIRE products.json / categories.json
// (multiple MB) just to read `.length`. That was the dominant cost of the
// dashboard. We now persist a tiny "count sidecar" file next to each dataset
// and read THAT instead. The in-memory cache is a first-level (per-instance)
// hit; the sidecar is the cross-invocation source of truth; a full load is the
// last-resort fallback (and it backfills the sidecar so it's a one-time cost).
const countsCache = new Map<string, { count: number; ts: number }>();
const COUNTS_TTL_MS = 3 * 60 * 1000; // 3 minutes

function getProductsCountSidecarPath(workspaceId: string): string {
  return `${workspaceId}/master/products.count.json`;
}

function getCategoriesCountSidecarPath(workspaceId: string): string {
  return `${workspaceId}/categories.count.json`;
}

async function readCountSidecar(path: string): Promise<number | null> {
  try {
    const data = await loadJsonFromStorageServer<{ count: number }>(path);
    if (data && typeof data.count === "number") return data.count;
    return null;
  } catch {
    return null;
  }
}

async function writeCountSidecar(path: string, count: number): Promise<void> {
  try {
    await saveJsonToStorageServer(path, { count, ts: Date.now() });
  } catch (err) {
    console.warn("[storage] failed to write count sidecar:", (err as Error).message);
  }
}

export function invalidateCachedCounts(workspaceId: string) {
  countsCache.delete(`products:${workspaceId}`);
  countsCache.delete(`categories:${workspaceId}`);
}

export async function getCachedProductsCountServer(workspaceId: string): Promise<number> {
  const key = `products:${workspaceId}`;
  const cached = countsCache.get(key);
  if (cached && Date.now() - cached.ts < COUNTS_TTL_MS) {
    return cached.count;
  }
  // Cheap path: read the tiny sidecar instead of the full products.json.
  const sidecar = await readCountSidecar(getProductsCountSidecarPath(workspaceId));
  if (sidecar !== null) {
    countsCache.set(key, { count: sidecar, ts: Date.now() });
    return sidecar;
  }
  // Fallback: full load (then backfill the sidecar for next time).
  const products = await loadProductsJsonServer(workspaceId);
  const count = products.length;
  countsCache.set(key, { count, ts: Date.now() });
  void writeCountSidecar(getProductsCountSidecarPath(workspaceId), count);
  return count;
}

export async function getCachedCategoriesCountServer(workspaceId: string): Promise<number> {
  const key = `categories:${workspaceId}`;
  const cached = countsCache.get(key);
  if (cached && Date.now() - cached.ts < COUNTS_TTL_MS) {
    return cached.count;
  }
  const sidecar = await readCountSidecar(getCategoriesCountSidecarPath(workspaceId));
  if (sidecar !== null) {
    countsCache.set(key, { count: sidecar, ts: Date.now() });
    return sidecar;
  }
  const categories = await loadCategoriesJsonServer(workspaceId);
  const count = categories.length;
  countsCache.set(key, { count, ts: Date.now() });
  void writeCountSidecar(getCategoriesCountSidecarPath(workspaceId), count);
  return count;
}

export async function loadProductsJsonServer(workspaceId: string): Promise<MasterProductJson[]> {
  const data = await loadJsonFromStorageServer<MasterProductJson[]>(getProductsStoragePath(workspaceId));
  return data ?? [];
}

export async function saveProductsJsonServer(workspaceId: string, products: MasterProductJson[]): Promise<void> {
  invalidateCachedCounts(workspaceId);
  await saveJsonToStorageServer(getProductsStoragePath(workspaceId), products);
  // Keep the count sidecar in sync so the dashboard never has to re-download
  // the full products.json just to count it.
  await writeCountSidecar(getProductsCountSidecarPath(workspaceId), products.length);
  countsCache.set(`products:${workspaceId}`, { count: products.length, ts: Date.now() });
}

export async function loadCategoriesJsonServer(workspaceId: string): Promise<CategoryJson[]> {
  const path = getCategoriesStoragePath(workspaceId);
  const data = await loadJsonFromStorageServer<CategoryJson[]>(path);
  return data ?? [];
}

export async function loadCategoriesRawJsonServer(workspaceId: string): Promise<Record<string, string>[]> {
  const path = getCategoriesRawStoragePath(workspaceId);
  const data = await loadJsonFromStorageServer<Record<string, string>[]>(path);
  return data ?? [];
}

export async function saveImageClassificationJsonServer(workspaceId: string, sessionId: string, data: ImageClassificationJson): Promise<void> {
  await saveJsonToStorageServer(getImageClassificationResultPath(workspaceId, sessionId), data);
}

export async function loadImageClassificationJsonServer(workspaceId: string, sessionId: string): Promise<ImageClassificationJson | null> {
  return loadJsonFromStorageServer<ImageClassificationJson>(getImageClassificationResultPath(workspaceId, sessionId));
}