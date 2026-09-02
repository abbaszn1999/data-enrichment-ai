import { createAdminClient } from "@/lib/supabase-admin";
import {
  getProjectStoragePath,
  type ProjectJson,
  type ProjectRow,
} from "@/lib/storage-helpers";
import { recordStorageWriteBytes } from "@/lib/observability/metrics";
import { catalogRowStoreEnabled } from "@/lib/catalog/flag";
import {
  hydrateProjectRows,
  patchCatalogSessionRows,
  replaceCatalogSessionRows,
} from "@/lib/catalog/session-rows";

const BUCKET = "workspace-files";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Storage GET requests are served through a CDN that can hand back a copy that
 * predates the write we just made. A run reads → mutates → writes this blob many
 * times per session, so a stale read silently resurrects old rows and erases
 * finished ones. A unique query string per request forces a cache miss.
 */
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

export async function loadProjectJsonAdmin(
  workspaceId: string,
  sessionId: string,
  admin: Admin = createAdminClient()
): Promise<ProjectJson | null> {
  const path = getProjectStoragePath(workspaceId, sessionId);
  const fresh = await downloadFresh(path);
  let project: ProjectJson | null = null;
  if (fresh !== null) {
    project = fresh === "" ? null : (JSON.parse(fresh) as ProjectJson);
  } else {
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error) {
      const message = error.message || "";
      if (/not found|object not found/i.test(message)) return null;
      throw error;
    }
    if (!data) return null;
    project = JSON.parse(await data.text()) as ProjectJson;
  }
  if (!project) return null;
  if (!catalogRowStoreEnabled()) return project;
  return hydrateProjectRows(admin, sessionId, project);
}

export async function saveProjectJsonAdmin(
  workspaceId: string,
  sessionId: string,
  project: ProjectJson,
  admin: Admin = createAdminClient()
): Promise<void> {
  const path = getProjectStoragePath(workspaceId, sessionId);
  const serialized = JSON.stringify(project);
  const blob = new Blob([serialized], {
    type: "application/octet-stream",
  });
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, blob, { cacheControl: "0", upsert: true });
  if (error) throw error;
  recordStorageWriteBytes(Buffer.byteLength(serialized, "utf8"), {
    kind: "catalog",
    workspaceId,
  });
  if (catalogRowStoreEnabled()) {
    await replaceCatalogSessionRows(admin, sessionId, project.rows);
  }
}

export async function patchProjectRowsAdmin(params: {
  workspaceId: string;
  sessionId: string;
  patches: Array<{
    id: string;
    status?: ProjectRow["status"];
    errorMessage?: string;
    enrichedData?: Record<string, unknown>;
    originalData?: Record<string, string>;
  }>;
  admin?: Admin;
}): Promise<ProjectJson> {
  const admin = params.admin ?? createAdminClient();
  if (catalogRowStoreEnabled()) {
    await patchCatalogSessionRows(admin, params.sessionId, params.patches);
    const project = await loadProjectJsonAdmin(
      params.workspaceId,
      params.sessionId,
      admin
    );
    if (!project) {
      throw new Error("Project data not found in storage");
    }
    return project;
  }
  const project = await loadProjectJsonAdmin(
    params.workspaceId,
    params.sessionId,
    admin
  );
  if (!project) {
    throw new Error("Project data not found in storage");
  }
  const byId = new Map(project.rows.map((row) => [row.id, row]));
  for (const patch of params.patches) {
    const row = byId.get(patch.id);
    if (!row) continue;
    if (patch.status) row.status = patch.status;
    if (patch.errorMessage !== undefined) row.errorMessage = patch.errorMessage;
    if (patch.originalData) row.originalData = { ...row.originalData, ...patch.originalData };
    if (patch.enrichedData) {
      row.enrichedData = { ...(row.enrichedData ?? {}), ...patch.enrichedData };
    }
  }
  await saveProjectJsonAdmin(params.workspaceId, params.sessionId, project, admin);
  return project;
}
