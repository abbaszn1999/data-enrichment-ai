/**
 * Server-side storage helpers for API routes.
 * Uses supabase-server (cookies-based) instead of supabase-browser.
 */
import { createClient } from "@/lib/supabase-server";
import type { ProjectJson, MasterProductJson, CategoryJson } from "@/lib/storage-helpers";
import { getCategoriesStoragePath } from "@/lib/storage-helpers";

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

export async function loadProductsJsonServer(workspaceId: string): Promise<MasterProductJson[]> {
  const data = await loadJsonFromStorageServer<MasterProductJson[]>(getProductsStoragePath(workspaceId));
  return data ?? [];
}

export async function saveProductsJsonServer(workspaceId: string, products: MasterProductJson[]): Promise<void> {
  await saveJsonToStorageServer(getProductsStoragePath(workspaceId), products);
}

export async function loadCategoriesJsonServer(workspaceId: string): Promise<CategoryJson[]> {
  const path = getCategoriesStoragePath(workspaceId);
  const data = await loadJsonFromStorageServer<CategoryJson[]>(path);
  return data ?? [];
}
