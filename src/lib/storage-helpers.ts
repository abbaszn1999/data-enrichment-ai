/**
 * Storage-first helpers: all project/product/category/supplier data
 * lives as JSON files in Supabase Storage. The database stores only
 * metadata (session name, status, storage_path, etc.).
 */
import { createClient } from "@/lib/supabase-browser";
import {
  getGalleryWorksheetPath,
} from "@/lib/gallery/storage-paths";
import type { GalleryWorksheetJson } from "@/lib/gallery/types";
import type { FaqItem, SessionKind } from "@/types";

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

  // A plain download can be answered from the storage CDN with a copy that
  // predates a very recent write (e.g. results a background job just saved).
  // A one-off signed URL plus a cache buster guarantees a fresh object.
  try {
    const signed = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60);
    if (signed.data?.signedUrl) {
      const response = await fetch(
        `${signed.data.signedUrl}&cb=${Date.now()}`,
        { cache: "no-store" }
      );
      if (response.status === 404) return null;
      if (response.ok) return (await response.json()) as T;
    }
  } catch {
    // Fall through to the SDK download below.
  }

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
  /** What this session enriches. Absent on projects created before the split. */
  kind?: SessionKind;
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
  /**
   * The user chose "Skip matching" in step 2, so every row is new by decision.
   * Later steps must not re-derive matchType, which would undo that choice.
   */
  matchingSkipped?: boolean;
  /**
   * Column used to collapse variant/attribute rows into one product
   * (typically Shopify `Handle`). `null` means grouping is explicitly off.
   * Absent means later steps may auto-detect.
   */
  productGroupColumn?: string | null;
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
  const res = await fetch("/api/catalog-intelligence/project", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, sessionId, project: data }),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(payload.error || "Failed to save catalog session");
  }
  return getProjectStoragePath(workspaceId, sessionId);
}

export async function loadProjectJson(workspaceId: string, sessionId: string): Promise<ProjectJson | null> {
  const params = new URLSearchParams({ workspaceId, sessionId });
  const res = await fetch(`/api/catalog-intelligence/project?${params.toString()}`);
  if (res.status === 404) return null;
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    project?: ProjectJson | null;
  };
  if (!res.ok) {
    throw new Error(payload.error || "Failed to load catalog session");
  }
  return payload.project ?? null;
}

// ─── Image Classification ────────────────────────────────

export interface ImageClassificationGroup {
  id: string;
  label: string;
  description?: string;
  imageIds: string[];
}

export interface ImageClassificationItem {
  id: string;
  filename: string;
  storagePath: string;
  /** Long-lived signed URL (10y) generated at classification time so the
   *  exported sheet has stable, ready-to-use links to share externally. */
  url: string;
  groupId: string;
  groupLabel: string;
  sku?: string;
  confidence?: number;
  notes?: string;
}

export interface ImageClassificationJson {
  sessionId: string;
  model: string;
  thinkingLevel?: string;
  createdAt: string;
  totalImages: number;
  groups: ImageClassificationGroup[];
  items: ImageClassificationItem[];
  usage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
    totalCost: number;
    totalCredits: number;
  };
}

export function getImageClassificationResultPath(workspaceId: string, sessionId: string): string {
  return `${workspaceId}/image-classification/${sessionId}/result.json`;
}

export function getImageClassificationImagesPrefix(workspaceId: string, sessionId: string): string {
  return `${workspaceId}/image-classification/${sessionId}/images`;
}

export function getImageClassificationImagePath(workspaceId: string, sessionId: string, imageId: string, ext: string): string {
  return `${getImageClassificationImagesPrefix(workspaceId, sessionId)}/${imageId}.${ext}`;
}

// ─── Products Gallery (paths + worksheet JSON) ───────────

export {
  getGalleryPrefix,
  getGalleryWorksheetPath,
  getGallerySourcePath,
  getGalleryRowImagePath,
  getGalleryExportPath,
} from "@/lib/gallery/storage-paths";

export type {
  GalleryWorksheetJson,
  GalleryRow,
  GallerySession,
  GalleryActiveRun,
} from "@/lib/gallery/types";

export async function saveGalleryWorksheet(
  workspaceId: string,
  sessionId: string,
  data: GalleryWorksheetJson
): Promise<string> {
  const path = getGalleryWorksheetPath(workspaceId, sessionId);
  await saveJsonToStorage(path, data);
  return path;
}

export async function loadGalleryWorksheet(
  workspaceId: string,
  sessionId: string
): Promise<GalleryWorksheetJson | null> {
  return loadJsonFromStorage<GalleryWorksheetJson>(
    getGalleryWorksheetPath(workspaceId, sessionId)
  );
}

export async function uploadImageToStorage(storagePath: string, blob: Blob): Promise<void> {
  const supabase = createClient();
  await supabase.storage.from(BUCKET).remove([storagePath]);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, blob, { cacheControl: "3600", upsert: true, contentType: blob.type || "image/jpeg" });
  if (error) throw error;
}

export async function getImageSignedUrl(storagePath: string, expiresInSec = 3600): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSec);
  if (error) return null;
  return data?.signedUrl ?? null;
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
  const res = await fetch("/api/products/catalog", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, products }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || "Failed to save catalog");
  }
  return getProductsStoragePath(workspaceId);
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
  originalId?: string | null; // Original CMS category_id (e.g. BigCommerce numeric id)
  sortOrder?: number;
  attributes?: any[];
  createdAt?: string;
  /** PLP enrichment output, written back from a Catalog Intelligence session. */
  seo?: CategorySeoContent;
}

export interface CategorySeoContent {
  seoTitle?: string;
  metaDescription?: string;
  h1?: string;
  introCopy?: string;
  seoCopy?: string;
  targetKeyword?: string;
  secondaryKeywords?: string[];
  faq?: FaqItem[];
  internalLinks?: string[];
  breadcrumbLabel?: string;
  /** Session id + timestamp of the run that produced this content. */
  updatedAt?: string;
  sourceSessionId?: string;
}

export function getCategoriesStoragePath(workspaceId: string): string {
  return `${workspaceId}/categories.json`;
}

export async function saveCategoriesJson(workspaceId: string, categories: CategoryJson[]): Promise<string> {
  const path = getCategoriesStoragePath(workspaceId);
  await saveJsonToStorage(path, categories);
  // Keep the count sidecar (read by the dashboard) accurate after a client-side write.
  try {
    await saveJsonToStorage(`${workspaceId}/categories.count.json`, { count: categories.length, ts: Date.now() });
  } catch { /* non-fatal */ }
  return path;
}

export async function loadCategoriesJson(workspaceId: string): Promise<CategoryJson[]> {
  const path = getCategoriesStoragePath(workspaceId);
  const data = await loadJsonFromStorage<CategoryJson[]>(path);
  return data ?? [];
}

// ─── Categories Raw Sheet (original uploaded rows) ────────

export function getCategoriesRawStoragePath(workspaceId: string): string {
  return `${workspaceId}/categories-raw.json`;
}

export async function saveCategoriesRawJson(workspaceId: string, rows: Record<string, string>[]): Promise<void> {
  await saveJsonToStorage(getCategoriesRawStoragePath(workspaceId), rows);
}

export async function loadCategoriesRawJson(workspaceId: string): Promise<Record<string, string>[]> {
  const data = await loadJsonFromStorage<Record<string, string>[]>(getCategoriesRawStoragePath(workspaceId));
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
