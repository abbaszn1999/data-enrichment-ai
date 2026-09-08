import { createAdminClient } from "@/lib/supabase-admin";
import type { MasterProductJson } from "@/lib/storage-helpers";
import { recordStorageWriteBytes } from "@/lib/observability/metrics";
import { productsRowStoreEnabled } from "@/lib/catalog/flag";
import {
  countWorkspaceProducts,
  replaceWorkspaceProducts,
} from "@/lib/catalog/row-store";

const BUCKET = "workspace-files";

type Admin = ReturnType<typeof createAdminClient>;

export class CatalogRevisionConflict extends Error {
  readonly code = "catalog_revision_conflict";

  constructor(message = "Catalog was updated by another session. Reload and try again.") {
    super(message);
    this.name = "CatalogRevisionConflict";
  }
}

export function getProductsStoragePath(workspaceId: string): string {
  return `${workspaceId}/master/products.json`;
}

function getProductsCountSidecarPath(workspaceId: string): string {
  return `${workspaceId}/master/products.count.json`;
}

async function downloadFresh(path: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${url}/storage/v1/object/${BUCKET}/${encoded}?cb=${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
    {
      cache: "no-store",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Cache-Control": "no-cache",
      },
    }
  );
  if (response.status === 404 || response.status === 400) return "";
  if (!response.ok) {
    throw new Error(`Storage download failed (${response.status})`);
  }
  return response.text();
}

export async function loadCatalogRevision(
  admin: Admin,
  workspaceId: string
): Promise<number> {
  const { data, error } = await admin
    .from("workspaces")
    .select("catalog_revision")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Number((data as { catalog_revision?: number } | null)?.catalog_revision ?? 0);
}

export async function loadCatalogProductsAdmin(
  admin: Admin,
  workspaceId: string
): Promise<MasterProductJson[]> {
  const path = getProductsStoragePath(workspaceId);
  const fresh = await downloadFresh(path);
  if (fresh !== null) {
    return fresh === "" ? [] : (JSON.parse(fresh) as MasterProductJson[]);
  }
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error) {
    const message = error.message || "";
    if (/not found|object not found/i.test(message)) return [];
    throw error;
  }
  if (!data) return [];
  return JSON.parse(await data.text()) as MasterProductJson[];
}

async function uploadCatalogBlob(
  admin: Admin,
  workspaceId: string,
  products: MasterProductJson[]
): Promise<void> {
  const path = getProductsStoragePath(workspaceId);
  const serialized = JSON.stringify(products);
  const blob = new Blob([serialized], { type: "application/octet-stream" });
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, blob, { cacheControl: "0", upsert: true });
  if (error) throw error;
  recordStorageWriteBytes(Buffer.byteLength(serialized, "utf8"), {
    kind: "catalog-master",
    workspaceId,
  });
  const sidecar = JSON.stringify({ count: products.length, ts: Date.now() });
  await admin.storage.from(BUCKET).upload(
    getProductsCountSidecarPath(workspaceId),
    new Blob([sidecar], { type: "application/octet-stream" }),
    { cacheControl: "0", upsert: true }
  );
}

/**
 * Compare-and-swap the master catalog blob. Claims `catalog_revision` in one
 * Postgres statement, then uploads. A null claim means another writer won.
 */
export async function saveCatalogWithCas(params: {
  admin: Admin;
  workspaceId: string;
  products: MasterProductJson[];
  expectedRevision: number;
  /** When false, skip rewriting workspace_products (caller already upserted). */
  syncTable?: boolean;
}): Promise<number> {
  const { data: nextRevision, error } = await params.admin.rpc(
    "claim_catalog_revision",
    {
      p_workspace_id: params.workspaceId,
      p_expected_revision: params.expectedRevision,
    }
  );
  if (error) throw new Error(error.message);
  if (nextRevision === null || nextRevision === undefined) {
    throw new CatalogRevisionConflict();
  }
  await uploadCatalogBlob(params.admin, params.workspaceId, params.products);
  if (productsRowStoreEnabled() && params.syncTable !== false) {
    await replaceWorkspaceProducts(
      params.admin,
      params.workspaceId,
      params.products
    );
  }
  return Number(nextRevision);
}

/** Copy products.json into workspace_products when the table is still empty. */
export async function backfillWorkspaceProductsIfNeeded(
  admin: Admin,
  workspaceId: string
): Promise<void> {
  if (!productsRowStoreEnabled()) return;
  const tableCount = await countWorkspaceProducts(admin, workspaceId);
  if (tableCount > 0) return;
  const products = await loadCatalogProductsAdmin(admin, workspaceId);
  if (products.length === 0) return;
  await replaceWorkspaceProducts(admin, workspaceId, products);
}
