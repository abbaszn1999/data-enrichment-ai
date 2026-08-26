import { createAdminClient } from "@/lib/supabase-admin";
import {
  getProjectStoragePath,
  type ProjectJson,
  type ProjectRow,
} from "@/lib/storage-helpers";

const BUCKET = "workspace-files";

type Admin = ReturnType<typeof createAdminClient>;

export async function loadProjectJsonAdmin(
  workspaceId: string,
  sessionId: string,
  admin: Admin = createAdminClient()
): Promise<ProjectJson | null> {
  const path = getProjectStoragePath(workspaceId, sessionId);
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error) {
    const message = error.message || "";
    if (/not found|object not found/i.test(message)) return null;
    throw error;
  }
  if (!data) return null;
  return JSON.parse(await data.text()) as ProjectJson;
}

export async function saveProjectJsonAdmin(
  workspaceId: string,
  sessionId: string,
  project: ProjectJson,
  admin: Admin = createAdminClient()
): Promise<void> {
  const path = getProjectStoragePath(workspaceId, sessionId);
  const blob = new Blob([JSON.stringify(project)], {
    type: "application/octet-stream",
  });
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, blob, { cacheControl: "0", upsert: true });
  if (error) throw error;
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
