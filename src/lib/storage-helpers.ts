/**
 * Storage-first helpers: all project/product/category/supplier data
 * lives as JSON files in Supabase Storage. The database stores only
 * metadata (session name, status, storage_path, etc.).
 */
import { createClient } from "@/lib/supabase-browser";

const BUCKET = "workspace-files";

// ─── Generic JSON read/write ─────────────────────────────

export async function saveJsonToStorage(storagePath: string, data: unknown): Promise<void> {
  const supabase = createClient();
  const blob = new Blob([JSON.stringify(data)], { type: "application/octet-stream" });

  // Delete existing file first to avoid stale cache / upsert issues
  await supabase.storage.from(BUCKET).remove([storagePath]);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, blob, { cacheControl: "0", upsert: true });
  if (error) throw error;
}

export async function loadJsonFromStorage<T = unknown>(storagePath: string): Promise<T | null> {
  const supabase = createClient();
  // Use download (not public URL) to bypass CDN cache
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);
  if (error) {
    // File not found → return null
    if (error.message?.includes("not found") || error.message?.includes("Object not found")) return null;
    throw error;
  }
  const text = await data.text();
  return JSON.parse(text) as T;
}

export async function deleteJsonFromStorage(storagePath: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([storagePath]);
  if (error) throw error;
}

// ─── Project JSON (import session data) ──────────────────

export interface ProjectJson {
  /** Columns from the original file */
  columns: string[];
  /** All rows with original + enriched data */
  rows: ProjectRow[];
  /** Source columns selected for AI */
  sourceColumns: string[];
  /** Enrichment column configs */
  enrichmentColumns: any[];
  /** Enrichment settings (language, model, etc.) */
  enrichmentSettings: any;
  /** Column visibility map */
  columnVisibility: Record<string, boolean>;
}

export interface ProjectRow {
  id: string;
  rowIndex: number;
  status: "pending" | "processing" | "done" | "error";
  errorMessage?: string;
  originalData: Record<string, string>;
  enrichedData: Record<string, any>;
  matchType?: "existing" | "new" | null;
}

export function getProjectStoragePath(workspaceId: string, sessionId: string): string {
  return `${workspaceId}/projects/${sessionId}.json`;
}

export async function saveProjectJson(workspaceId: string, sessionId: string, data: ProjectJson): Promise<string> {
  const path = getProjectStoragePath(workspaceId, sessionId);
  await saveJsonToStorage(path, data);
  return path;
}

export async function loadProjectJson(workspaceId: string, sessionId: string): Promise<ProjectJson | null> {
  const path = getProjectStoragePath(workspaceId, sessionId);
  return loadJsonFromStorage<ProjectJson>(path);
}

// ─── Master Products JSON ────────────────────────────────

export interface MasterProductJson {
  sku: string;
  data: Record<string, any>;
  enrichedData?: Record<string, any>;
  categoryId?: string;
  status?: string;
  createdAt?: string;
}

export function getProductsStoragePath(workspaceId: string): string {
  return `${workspaceId}/master/products.json`;
}

export async function saveProductsJson(workspaceId: string, products: MasterProductJson[]): Promise<string> {
  const path = getProductsStoragePath(workspaceId);
  await saveJsonToStorage(path, products);
  return path;
}

export async function loadProductsJson(workspaceId: string): Promise<MasterProductJson[]> {
  const path = getProductsStoragePath(workspaceId);
  const data = await loadJsonFromStorage<MasterProductJson[]>(path);
  return data ?? [];
}

// ─── Categories JSON ─────────────────────────────────────

export interface CategoryJson {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parentId?: string | null;
  sortOrder?: number;
  attributes?: any[];
  createdAt?: string;
}

export function getCategoriesStoragePath(workspaceId: string): string {
  return `${workspaceId}/categories.json`;
}

export async function saveCategoriesJson(workspaceId: string, categories: CategoryJson[]): Promise<string> {
  const path = getCategoriesStoragePath(workspaceId);
  await saveJsonToStorage(path, categories);
  return path;
}

export async function loadCategoriesJson(workspaceId: string): Promise<CategoryJson[]> {
  const path = getCategoriesStoragePath(workspaceId);
  const data = await loadJsonFromStorage<CategoryJson[]>(path);
  return data ?? [];
}

// ─── Suppliers JSON ──────────────────────────────────────

export interface SupplierJson {
  id: string;
  name: string;
  defaultColumnMapping?: any;
  defaultMatchingRules?: any;
  defaultMatchColumn?: string;
  lastImportAt?: string;
  createdAt?: string;
}

export function getSuppliersStoragePath(workspaceId: string): string {
  return `${workspaceId}/suppliers.json`;
}

export async function saveSuppliersJson(workspaceId: string, suppliers: SupplierJson[]): Promise<string> {
  const path = getSuppliersStoragePath(workspaceId);
  await saveJsonToStorage(path, suppliers);
  return path;
}

export async function loadSuppliersJson(workspaceId: string): Promise<SupplierJson[]> {
  const path = getSuppliersStoragePath(workspaceId);
  const data = await loadJsonFromStorage<SupplierJson[]>(path);
  return data ?? [];
}
